/* =========================================================================
   SERVEUR — sert le site et partage les lignes entre tous les postes.

   Bibliothèque standard de Node, rien d'autre : pas de npm, pas de build, pas
   de base de données. L'état vit dans un seul fichier JSON sur le volume, et le
   site reste servable en fichiers statiques bruts sans ce serveur (GitHub Pages
   en secours) — l'appli retombe alors sur son stockage local.

   Le serveur ne connaît pas le schéma de l'atelier : il reçoit des mutations
   (`ajout`, `modif`, `corbeille`, `restauration`) désignant une table et une
   ligne par identifiant, et les applique bêtement. Ajouter une colonne ou une
   machine reste une affaire de `assets/js/schema.js`.

   Règle de la maison, ici aussi : rien ne disparaît. Le journal est en ajout
   seul, une ligne retirée part à la corbeille, un fichier illisible est mis de
   côté au lieu d'être écrasé, et chaque premier écrit du jour laisse une copie
   datée sur le volume.
   ========================================================================= */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const RACINE = __dirname;

/* Le code d'atelier est partagé par toute l'entreprise et vit en variable
   d'environnement Railway. Absent, le serveur reste ouvert : c'est le mode
   pratique en local, jamais celui de la production. */
const CODE = String(process.env.CODE_ATELIER || '').trim();

const VERSION = 1;
const MAX_CORPS = 2 * 1024 * 1024;
/** Même fenêtre que `noteModif()` côté navigateur : les deux doivent coalescer
    la même frappe, sinon le journal du serveur en dirait autre chose. */
const COALESCE_MS = 120000;

const maintenant = () => new Date().toISOString();

/* ============================== STOCKAGE ================================= */

/**
 * Le volume Railway est monté sur /data. En local il n'existe pas : on retombe
 * sur ./data plutôt que d'échouer au démarrage. Un dossier non inscriptible est
 * une panne franche — mieux vaut ne pas démarrer que faire croire à un partage.
 */
function resoudreDossier() {
  const voulu = process.env.DATA_DIR || '/data';
  for (const d of [voulu, path.join(RACINE, 'data')]) {
    try {
      fs.mkdirSync(d, { recursive: true });
      fs.accessSync(d, fs.constants.W_OK);
      if (d !== voulu) console.warn(`[donnees] ${voulu} indisponible, repli sur ${d}`);
      return d;
    } catch (_) { /* essai suivant */ }
  }
  throw new Error(`Aucun dossier de données inscriptible (${voulu}).`);
}

const DOSSIER = resoudreDossier();
const FICHIER = path.join(DOSSIER, 'atelier.json');

const neuf = () => ({ version: VERSION, seq: 0, updated: null, tables: {}, trash: [], journal: [] });

let etat = neuf();
/** Identifiants de mutation déjà appliqués : une reprise d'envoi ne doit pas
    créer la ligne deux fois. Reconstruit du journal au démarrage. */
let vus = new Map();

function charge() {
  let brut = null;
  try {
    brut = fs.readFileSync(FICHIER, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.log('[donnees] premier démarrage, état vierge.');
    return;
  }
  try {
    const lu = JSON.parse(brut);
    if (!lu || typeof lu !== 'object') throw new Error('contenu inattendu');
    etat = {
      version: VERSION,
      seq: Number(lu.seq) || 0,
      updated: lu.updated || null,
      tables: lu.tables && typeof lu.tables === 'object' ? lu.tables : {},
      trash: Array.isArray(lu.trash) ? lu.trash : [],
      journal: Array.isArray(lu.journal) ? lu.journal : [],
    };
  } catch (e) {
    // Illisible n'est pas vide : la version brute est mise de côté, récupérable
    // à la main. L'écraser perdrait des données qui ne se régénèrent pas.
    const aside = FICHIER + '.corrompu-' + maintenant().replace(/[:.]/g, '-');
    try { fs.writeFileSync(aside, brut); } catch (_) { /* volume plein */ }
    console.error(`[donnees] fichier illisible (${e.message}), mis de côté : ${aside}`);
    return;
  }
  etat.journal.forEach((e, i) => { if (e && e.mid) vus.set(e.mid, i); });
  console.log(`[donnees] ${compteLignes()} ligne(s), ${etat.journal.length} entrée(s) de journal, seq ${etat.seq}.`);
}

const compteLignes = () =>
  Object.values(etat.tables).reduce((s, r) => s + (Array.isArray(r) ? r.length : 0), 0);

/**
 * Une copie datée par jour : si une mauvaise manœuvre passe par l'API, la veille
 * est toujours sur le volume. Les fichiers sont minuscules, on n'en efface
 * aucun.
 */
function copieDuJour() {
  const jour = maintenant().slice(0, 10);
  const copie = path.join(DOSSIER, `atelier-${jour}.json`);
  if (fs.existsSync(copie) || !fs.existsSync(FICHIER)) return;
  try { fs.copyFileSync(FICHIER, copie); } catch (e) { console.error('[donnees] copie du jour impossible.', e); }
}

/** Écriture par fichier temporaire puis renommage : une coupure de courant en
    plein écrit laisse l'ancien fichier intact plutôt qu'un JSON tronqué. */
function ecris() {
  copieDuJour();
  const tmp = FICHIER + '.tmp';
  etat.updated = maintenant();
  fs.writeFileSync(tmp, JSON.stringify(etat));
  fs.renameSync(tmp, FICHIER);
}

charge();

/* ============================== MUTATIONS ================================ */

const tableDe = (id) => (Array.isArray(etat.tables[id]) ? etat.tables[id] : (etat.tables[id] = []));

function trouveLigne(tableId, rowId) {
  const i = tableDe(tableId).findIndex((r) => r && r._id === rowId);
  return i < 0 ? null : { rows: tableDe(tableId), i };
}

const dansCorbeille = (rowId) => etat.trash.findIndex((t) => t && t.row && t.row._id === rowId);

/** La ligne existe-t-elle quelque part ? Un `ajout` rejoué ne doit pas la
    dupliquer, même si elle est partie à la corbeille entre-temps. */
function connue(rowId) {
  if (dansCorbeille(rowId) >= 0) return true;
  return Object.values(etat.tables).some((rows) =>
    Array.isArray(rows) && rows.some((r) => r && r._id === rowId));
}

const propre = (v) => (v == null ? '' : String(v));

/**
 * Applique une mutation et consigne au journal. Retourne true si l'état a
 * bougé — c'est ce qui fait avancer `seq`, donc ce qui réveille les autres
 * postes.
 *
 * Une mutation déjà vue est ignorée, sauf la coalescence de `modif` : tant que
 * l'opérateur tape dans le même champ, le navigateur renvoie le même `mid` avec
 * la valeur du moment et on prolonge l'entrée en cours. C'est la seule
 * réécriture de journal admise, la même exception assumée que côté navigateur.
 */
function applique(m) {
  if (!m || typeof m !== 'object' || !m.mid || !m.op) return false;

  const dejaVu = vus.has(m.mid);
  if (dejaVu && m.op !== 'modif') return false;

  const t = typeof m.t === 'string' ? m.t : maintenant();
  const poste = String(m.poste || '').slice(0, 24);
  const table = String(m.table || '');
  const rowId = String(m.row || '');

  switch (m.op) {

    case 'ajout': {
      if (!table || !rowId || connue(rowId)) return false;
      const ligne = { _id: rowId };
      const v = m.valeurs && typeof m.valeurs === 'object' ? m.valeurs : {};
      for (const k of Object.keys(v)) if (k !== '_id') ligne[k] = propre(v[k]);
      if (m.prepend) tableDe(table).unshift(ligne); else tableDe(table).push(ligne);
      journalise({ mid: m.mid, t, poste, op: 'ajout', table, row: rowId, resume: propre(m.resume) });
      return true;
    }

    case 'modif': {
      if (!table || !rowId || !m.champ) return false;
      const champ = String(m.champ);
      const apres = propre(m.apres);
      const trouve = trouveLigne(table, rowId);
      const enCorbeille = trouve ? -1 : dansCorbeille(rowId);
      const ligne = trouve ? trouve.rows[trouve.i]
        : (enCorbeille >= 0 ? etat.trash[enCorbeille].row : null);
      // La ligne peut avoir disparu d'ici (poste hors ligne longtemps). On
      // consigne quand même : le journal doit garder la trace de la frappe.
      if (ligne) ligne[champ] = apres;

      if (dejaVu) return prolonge(m.mid, apres, t, propre(m.resume));
      journalise({
        mid: m.mid, t, poste, op: 'modif', table, row: rowId, champ,
        avant: propre(m.avant), apres, resume: propre(m.resume),
      });
      return true;
    }

    case 'corbeille': {
      const trouve = trouveLigne(table, rowId);
      if (!trouve) return false;
      const [ligne] = trouve.rows.splice(trouve.i, 1);
      etat.trash.push({ table, row: ligne, at: t, poste });
      journalise({ mid: m.mid, t, poste, op: 'corbeille', table, row: rowId, resume: propre(m.resume) });
      return true;
    }

    case 'restauration': {
      const i = dansCorbeille(rowId);
      if (i < 0) return false;
      const [item] = etat.trash.splice(i, 1);
      const cible = item.table || table;
      if (m.prepend) tableDe(cible).unshift(item.row); else tableDe(cible).push(item.row);
      journalise({ mid: m.mid, t, poste, op: 'restauration', table: cible, row: rowId, resume: propre(m.resume) });
      return true;
    }

    default:
      return false;
  }
}

function journalise(entree) {
  vus.set(entree.mid, etat.journal.length);
  etat.journal.push(entree);
}

/**
 * Prolonge l'entrée de journal d'une frappe en cours. Hors de la fenêtre de
 * coalescence, on ouvre une entrée neuve plutôt que de réécrire une trace
 * ancienne. Revenu à la valeur de départ, l'entrée n'a plus lieu d'être — c'est
 * le seul retrait de journal, et il ne concerne que la dernière entrée.
 */
function prolonge(mid, apres, t, resume) {
  const i = vus.get(mid);
  const e = etat.journal[i];
  if (!e || e.op !== 'modif') return false;
  if (Date.now() - Date.parse(e.t) > COALESCE_MS) {
    journalise({ mid: mid + '+', t, poste: e.poste, op: 'modif', table: e.table, row: e.row, champ: e.champ, avant: e.apres, apres, resume });
    vus.set(mid, etat.journal.length - 1);
    return true;
  }
  if (e.apres === apres) return false;
  e.apres = apres;
  e.t = t;
  if (resume) e.resume = resume;
  if (e.avant === e.apres && i === etat.journal.length - 1) {
    etat.journal.pop();
    vus.delete(mid);
  }
  return true;
}

/* ============================== RÉPONSES ================================= */

/**
 * Les tableaux et la corbeille partent en entier — quelques centaines de lignes,
 * c'est négligeable. Le journal, lui, grossit sans fin : le poste dit ce qu'il
 * connaît déjà et ne reçoit que la suite.
 */
/** Paramètre de requête absent : NaN, jamais 0 — la nuance décide de la
    réponse (« rien n'a bougé » contre « voilà tout »). */
const nombre = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

function instantane(seqConnu, jConnu) {
  if (Number.isFinite(seqConnu) && seqConnu === etat.seq) {
    return { seq: etat.seq, inchange: true, code: !!CODE };
  }
  const depuis = Number.isFinite(jConnu) && jConnu >= 0 && jConnu <= etat.journal.length ? jConnu : 0;
  return {
    seq: etat.seq,
    updated: etat.updated,
    tables: etat.tables,
    trash: etat.trash,
    journal: etat.journal.slice(depuis),
    jDepuis: depuis,
    jTotal: etat.journal.length,
    code: !!CODE,
  };
}

/* ============================== HTTP ===================================== */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

function entetes(res, extra) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Tout est revalidé : après un correctif, aucun poste ne doit rester sur une
  // version périmée. L'ETag renvoie 304 quand rien n'a bougé.
  res.setHeader('Cache-Control', 'no-cache');
  for (const k of Object.keys(extra || {})) res.setHeader(k, extra[k]);
}

function json(res, code, obj) {
  const corps = JSON.stringify(obj);
  entetes(res, { 'Content-Type': MIME['.json'] });
  res.writeHead(code);
  res.end(corps);
}

/**
 * Comparaison à durée constante : sur un code court, mesurer le temps de
 * réponse dirait combien de caractères sont bons.
 */
function codeValide(req) {
  if (!CODE) return true;
  const recu = Buffer.from(String(req.headers['x-code-atelier'] || ''));
  const attendu = Buffer.from(CODE);
  if (recu.length !== attendu.length) return false;
  return crypto.timingSafeEqual(recu, attendu);
}

function lisCorps(req) {
  return new Promise((resolve, reject) => {
    const bouts = [];
    let taille = 0;
    req.on('data', (c) => {
      taille += c.length;
      if (taille > MAX_CORPS) { reject(new Error('Corps trop volumineux.')); req.destroy(); return; }
      bouts.push(c);
    });
    req.on('end', () => {
      try { resolve(bouts.length ? JSON.parse(Buffer.concat(bouts).toString('utf8')) : {}); }
      catch (e) { reject(new Error('JSON invalide.')); }
    });
    req.on('error', reject);
  });
}

/* Liste blanche : seuls le point d'entrée et les fichiers d'`assets` sortent.
   Le reste du dépôt (server.js, README, classeur source) n'est pas servable. */
function fichierStatique(chemin) {
  if (chemin === '/' || chemin === '/index.html') return path.join(RACINE, 'index.html');
  if (!chemin.startsWith('/assets/')) return null;
  const cible = path.join(RACINE, path.normalize(chemin).replace(/^(\.\.[/\\])+/, ''));
  return cible.startsWith(path.join(RACINE, 'assets') + path.sep) ? cible : null;
}

function sersStatique(req, res, chemin) {
  // Routage par hash : toute URL inconnue retombe sur le point d'entrée.
  const cible = fichierStatique(chemin) || path.join(RACINE, 'index.html');
  let st;
  try { st = fs.statSync(cible); } catch (_) { res.writeHead(404); res.end('Introuvable'); return; }

  const etag = `W/"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
  entetes(res, { 'Content-Type': MIME[path.extname(cible)] || 'application/octet-stream', ETag: etag });
  if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return; }
  res.writeHead(200, { 'Content-Length': st.size });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(cible).pipe(res);
}

const serveur = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const chemin = url.pathname;

  try {
    /* Sonde d'accueil : elle dit au poste qu'un serveur de partage existe et
       s'il faut un code, sans rien livrer des données. */
    if (chemin === '/api/sante') {
      return json(res, 200, { ok: true, code: !!CODE, seq: etat.seq, version: VERSION });
    }

    if (chemin === '/api/etat' || chemin === '/api/ops') {
      if (!codeValide(req)) return json(res, 401, { erreur: 'code', message: 'Code d’atelier requis.' });

      if (chemin === '/api/etat' && (req.method === 'GET' || req.method === 'HEAD')) {
        // Absent ≠ zéro : `Number(null)` vaut 0, et un poste neuf se serait vu
        // répondre « rien n'a bougé » par un serveur encore à seq 0 — donc
        // jamais servi l'état de départ.
        return json(res, 200, instantane(nombre(url.searchParams.get('seq')), nombre(url.searchParams.get('j'))));
      }

      if (chemin === '/api/ops' && req.method === 'POST') {
        const corps = await lisCorps(req);
        const mutations = Array.isArray(corps.mutations) ? corps.mutations : [];
        if (mutations.length > 5000) return json(res, 413, { erreur: 'trop', message: 'Trop de mutations d’un coup.' });

        let bouge = 0;
        for (const m of mutations) { if (applique(m)) { etat.seq++; bouge++; } }
        if (bouge) {
          try { ecris(); } catch (e) {
            // Refuser franchement : un poste qui croit avoir enregistré est pire
            // qu'un poste qui sait que ça n'est pas passé. L'état en mémoire a
            // bougé, il repartira au prochain écrit réussi.
            console.error('[donnees] écriture impossible.', e);
            return json(res, 500, { erreur: 'ecriture', message: String(e.message || e) });
          }
        }
        // La réponse porte l'état à jour : le poste converge sans second appel.
        return json(res, 200, Object.assign({ recues: mutations.length, appliquees: bouge },
          instantane(NaN, nombre(corps.j))));
      }

      res.writeHead(405);
      return res.end('Méthode non autorisée');
    }

    if (chemin.startsWith('/api/')) return json(res, 404, { erreur: 'inconnu' });

    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Méthode non autorisée'); }
    return sersStatique(req, res, chemin);

  } catch (e) {
    console.error('[http]', req.method, chemin, e);
    if (!res.headersSent) return json(res, 400, { erreur: 'requete', message: String(e.message || e) });
    res.end();
  }
});

serveur.listen(PORT, () => {
  console.log(`[serveur] http://0.0.0.0:${PORT} · données ${FICHIER} · code ${CODE ? 'exigé' : 'DÉSACTIVÉ'}`);
});
