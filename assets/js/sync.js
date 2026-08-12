/* =========================================================================
   SYNC — le même tableau sur tous les postes de l'entreprise.

   Le navigateur reste maître de l'affichage : il écrit d'abord dans son
   stockage local, l'écran répond tout de suite, et l'écriture part *ensuite*
   vers le serveur. Réseau coupé, tablette sortie du wifi, serveur redémarré :
   la saisie continue, les écritures s'empilent dans une file conservée en
   localStorage, et elles repartent au retour du réseau.

   Sans serveur de partage — fichiers ouverts en local, secours GitHub Pages —
   la sonde d'accueil échoue et tout ce fichier se met en veille : l'appli
   redevient exactement celle d'avant, chaque poste avec ses données.

   Trois pièces seulement :
     · la file d'envoi (outbox), persistée, rejouable, sans perte ;
     · un cycle qui envoie ce qui attend puis relit l'état du serveur ;
     · un repère (seq) qui dit en un aller-retour minuscule si rien n'a bougé.
   ========================================================================= */

const Sync = (() => {
  const KEY_CODE = 'maintenance-atelier/code';
  const KEY_FILE = 'maintenance-atelier/outbox';
  const KEY_REPERE = 'maintenance-atelier/sync';

  /** Rythme de relecture quand l'onglet est visible. Onglet caché : rien. */
  const PERIODE_MS = 5000;
  /** Après une écriture, on n'attend pas le cycle : on part presque tout de
      suite, mais assez tard pour qu'une phrase tapée ne fasse qu'un envoi. */
  const APRES_FRAPPE_MS = 700;
  const TIMEOUT_MS = 12000;
  /** Réseau coupé : on espace les tentatives au lieu de marteler. */
  const ATTENTE_MIN = 3000;
  const ATTENTE_MAX = 60000;

  /* 'sonde'   — on cherche encore s'il y a un serveur
     'local'   — pas de serveur : chaque poste garde ses données (comportement d'origine)
     'code'    — serveur présent, code d'atelier manquant ou refusé
     'partage' — connecté, à jour
     'attente' — serveur connu mais injoignable ; les écritures patientent */
  let mode = 'sonde';
  let derniereErreur = null;

  let file = [];
  let repere = { seq: null, jTotal: 0, serveur: false };
  /** Vrai seulement quand l'adresse a répondu « il n'y a pas d'API ici » : site
      ouvert en fichiers, secours GitHub Pages. Un réseau coupé ne le dit pas. */
  let apiAbsente = false;
  /** Le premier échange d'une session ramène l'état complet : c'est lui qui
      permet de repérer les lignes que le serveur ne connaît pas encore. */
  let premierEchange = true;
  let enCours = false;
  let minuteur = null;
  let recul = ATTENTE_MIN;
  /** Compteur d'états reçus du serveur : l'écran ne se repeint que quand il
      change, pas à chaque battement du cycle. */
  let majs = 0;

  const abonnes = [];
  const previens = () => abonnes.forEach((fn) => fn(mode, api.info()));

  /* ------------------------------------------------------- stockage ------- */

  const lis = (cle, defaut) => {
    try {
      const v = localStorage.getItem(cle);
      return v ? JSON.parse(v) : defaut;
    } catch (_) { return defaut; }
  };
  const ecris = (cle, valeur) => {
    try { localStorage.setItem(cle, JSON.stringify(valeur)); return true; } catch (_) { return false; }
  };

  const code = () => {
    try { return localStorage.getItem(KEY_CODE) || ''; } catch (_) { return ''; }
  };

  /**
   * La file est écrite à chaque changement : si le navigateur se ferme avant
   * l'envoi, la saisie repart au prochain démarrage. C'est le seul endroit d'où
   * une écriture peut être perdue, donc le seul qui compte vraiment.
   */
  function rangeFile() {
    if (!ecris(KEY_FILE, file)) console.error('File d’envoi non conservée : stockage refusé.');
  }

  /* -------------------------------------------------------- réseau -------- */

  async function appel(chemin, options) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const entetes = { Accept: 'application/json' };
      const c = code();
      if (c) entetes['X-Code-Atelier'] = c;
      if (options && options.body) entetes['Content-Type'] = 'application/json';

      const rep = await fetch(chemin, Object.assign({
        cache: 'no-store', headers: entetes, signal: ctrl.signal,
      }, options));

      if (!rep.ok) {
        const e = new Error(rep.status === 401 ? 'Code d’atelier refusé.' : 'Serveur : ' + rep.status);
        e.code = rep.status;
        // 404 : l'adresse répond, mais il n'y a pas d'API dessus.
        e.absent = rep.status === 404;
        throw e;
      }
      // Une page HTML (GitHub Pages, fichiers ouverts en local, portail wifi)
      // n'est pas un serveur de partage : mieux vaut le voir ici que planter au
      // premier accès.
      const type = rep.headers.get('content-type') || '';
      if (!type.includes('json')) { const e = new Error('Réponse inattendue.'); e.absent = true; throw e; }
      return rep.json();
    } finally { clearTimeout(t); }
  }

  /* --------------------------------------------------------- cycle -------- */

  function programme(delai) {
    clearTimeout(minuteur);
    if (mode === 'local' || mode === 'code') return;
    // Onglet caché : plus de relecture, personne ne regarde. Mais ce qui attend
    // d'être envoyé part quand même — une ligne saisie juste avant de basculer
    // sur une autre appli ne doit pas dormir jusqu'au retour de l'opérateur.
    if (document.hidden && !file.length) return;
    minuteur = setTimeout(cycle, delai);
  }

  /** Les lignes que le serveur connaît, tableaux et corbeille confondus. */
  function identifiantsServeur(payload) {
    const ids = new Set();
    for (const rows of Object.values(payload.tables || {})) {
      if (Array.isArray(rows)) for (const r of rows) if (r && r._id) ids.add(r._id);
    }
    for (const t of payload.trash || []) if (t && t.row && t.row._id) ids.add(t.row._id);
    return ids;
  }

  async function cycle() {
    if (enCours || mode === 'local' || mode === 'code') return;
    enCours = true;
    clearTimeout(minuteur);

    const envoyees = file.slice(0, 500);
    try {
      let payload;
      if (envoyees.length) {
        payload = await appel('api/ops', {
          method: 'POST',
          body: JSON.stringify({ mutations: envoyees, j: repere.jTotal }),
        });
        // Acquittées : on ne retire que ces objets-là. Une frappe arrivée
        // pendant l'aller-retour a remplacé son entrée en file — l'identité
        // diffère, la nouvelle valeur reste et partira au tour suivant.
        file = file.filter((m) => !envoyees.includes(m));
        rangeFile();
      } else {
        const q = new URLSearchParams({ j: String(repere.jTotal) });
        if (!premierEchange && repere.seq !== null) q.set('seq', String(repere.seq));
        payload = await appel('api/etat?' + q.toString());
      }

      // Le mode bascule avant d'appliquer : l'écran se repeint à l'intérieur
      // d'appliquer(), il doit déjà lire « partagé » et non l'état d'avant.
      recul = ATTENTE_MIN;
      basculer('partage');
      appliquer(payload);
      programme(file.length ? APRES_FRAPPE_MS : PERIODE_MS);

    } catch (e) {
      derniereErreur = e;
      if (e.code === 401) {
        basculer('code');
      } else {
        // Rien n'est perdu : la file garde les écritures, on réessaie plus tard.
        basculer('attente');
        recul = Math.min(recul * 2, ATTENTE_MAX);
        programme(recul);
      }
    } finally { enCours = false; }
  }

  function appliquer(payload) {
    if (!payload) return;
    if (typeof payload.seq === 'number') repere.seq = payload.seq;

    if (!payload.inchange && payload.tables) {
      if (premierEchange) {
        // Amorçage : les lignes déjà saisies sur ce poste — ou saisies hors
        // ligne — sont poussées avant d'accepter l'état du serveur, sinon
        // accepter cet état les ferait disparaître de l'écran.
        const manquantes = Store.aEnvoyer(identifiantsServeur(payload));
        if (manquantes.length) file = manquantes.concat(file);
      }
      Store.applyRemote(payload);
      if (typeof payload.jTotal === 'number') repere.jTotal = payload.jTotal;
      majs++;
    }
    premierEchange = false;
    // Ce qui n'est pas encore parti se réapplique par-dessus : l'écran ne
    // revient jamais en arrière sous les yeux de l'opérateur.
    if (file.length) Store.rejoue(file);
    ecris(KEY_REPERE, repere);
    previens();
  }

  function basculer(m) {
    if (mode === m) { previens(); return; }
    mode = m;
    previens();
  }

  /* ---------------------------------------------------------- API --------- */

  const api = {

    /**
     * Sonde d'accueil : y a-t-il un serveur de partage à cette adresse ? La
     * réponse dit aussi s'il exige un code, ce qui évite de demander un code à
     * l'opérateur là où il n'en faut pas.
     *
     * Deux échecs bien différents. « Pas d'API ici » (404, page HTML) est un
     * verdict : le site est servi en fichiers, on repasse en mode poste. Un
     * réseau coupé n'est qu'un silence — si ce navigateur a déjà vu le serveur,
     * on attend et on réessaie plutôt que de basculer en local, sans quoi une
     * panne d'une minute ferait travailler l'atelier toute la journée sur des
     * données qui ne remonteraient jamais.
     */
    async init() {
      file = Array.isArray(lis(KEY_FILE, [])) ? lis(KEY_FILE, []) : [];
      const r = lis(KEY_REPERE, null);
      if (r && typeof r === 'object') {
        repere = { seq: null, jTotal: Number(r.jTotal) || 0, serveur: !!r.serveur };
      }

      Store.onMutation(api.pousse);
      return api.reprend();
    },

    /** (Re)cherche le serveur. Rejouable : appelée au retour du réseau. */
    async reprend() {
      let sante = null;
      let absent = false;
      try {
        sante = await appel('api/sante');
      } catch (e) {
        absent = !!e.absent;
      }

      if (!sante || !sante.ok) {
        apiAbsente = absent;
        // Déjà relié une fois : le serveur existe, il est seulement muet.
        if (!absent && (repere.serveur || code())) {
          basculer('attente');
          programme(ATTENTE_MIN);
          return mode;
        }
        basculer('local');
        return mode;
      }

      apiAbsente = false;
      repere.serveur = true;
      ecris(KEY_REPERE, repere);
      if (sante.code && !code()) { basculer('code'); return mode; }

      // On reste en « sonde » le temps du premier échange : annoncer « hors
      // ligne » une demi-seconde avant « partagé » se lirait comme une panne.
      await cycle();
      return mode;
    },

    /** Une écriture du store part vers le serveur — ou attend son tour. */
    pousse(m) {
      // On n'empile que si un partage est possible. Sur un site servi en
      // fichiers, la file ne partirait jamais et grossirait pour rien.
      if (apiAbsente) return;
      // Frappe en cours : la même écriture est renvoyée à chaque caractère avec
      // le même mid. On remplace au lieu d'empiler, un seul envoi suffit.
      const i = m.op === 'modif' ? file.findIndex((x) => x.mid === m.mid) : -1;
      if (i >= 0) file[i] = m; else file.push(m);
      rangeFile();
      previens();
      programme(APRES_FRAPPE_MS);
    },

    /** Après une restauration .json : renvoyer au serveur ce qu'il ignore. */
    reconcilie() {
      if (mode === 'local') return;
      premierEchange = true;
      api.maintenant();
    },

    maintenant() {
      if (mode === 'code' || apiAbsente) return;
      recul = ATTENTE_MIN;
      // Passé en local faute de réseau : on retente la sonde, pas le cycle.
      if (mode === 'local') { api.reprend(); return; }
      programme(0);
    },

    /** Le code d'atelier, saisi une fois par navigateur puis mémorisé. */
    async essaieCode(valeur) {
      const v = String(valeur || '').trim();
      if (!v) return false;
      try { localStorage.setItem(KEY_CODE, v); } catch (_) { /* stockage bloqué */ }
      mode = 'attente';
      premierEchange = true;
      try {
        await cycle();
      } catch (_) { /* le mode dit déjà ce qui s'est passé */ }
      if (mode === 'code') { try { localStorage.removeItem(KEY_CODE); } catch (_) { /* rien */ } }
      return mode === 'partage';
    },

    oublieCode() {
      try { localStorage.removeItem(KEY_CODE); } catch (_) { /* rien */ }
      basculer('code');
    },

    onState(fn) { abonnes.push(fn); },
    mode() { return mode; },
    /** Vrai dès qu'un serveur de partage existe, joignable ou non. */
    actif() { return mode === 'partage' || mode === 'attente'; },
    enAttente() { return file.length; },
    erreur() { return derniereErreur; },
    info() { return { enAttente: file.length, seq: repere.seq, majs, erreur: derniereErreur }; },
  };

  /* Retour de l'onglet, du réseau, ou réveil de la tablette : on relit tout de
     suite plutôt que d'attendre le prochain tour. */
  document.addEventListener('visibilitychange', () => { if (!document.hidden) api.maintenant(); });
  window.addEventListener('online', () => api.maintenant());
  window.addEventListener('focus', () => api.maintenant());

  return api;
})();
