/* =========================================================================
   STORE — persistance locale, journal des écritures, corbeille,
   sauvegarde/restauration, export CSV.

   Le stockage du navigateur reste la source d'affichage : tout se lit et
   s'écrit là, instantanément, même serveur coupé. Quand un serveur de partage
   répond (voir sync.js), chaque écriture part aussi sous forme de *mutation* et
   l'état des autres postes revient par `applyRemote()`. Sans serveur, rien de
   tout ça ne s'active et l'appli fonctionne exactement comme avant.

   Règle de la maison : rien ne disparaît. Une valeur écrasée laisse son
   ancienne version au journal, une ligne retirée part à la corbeille, un
   stockage illisible est mis de côté au lieu d'être écrasé.
   ========================================================================= */

const Store = (() => {
  /* La clé ne change jamais : c'est elle qui retrouve les données déjà saisies
     sur le poste. Les évolutions de forme se gèrent dans load(), pas ici. */
  const KEY = 'maintenance-atelier/v1';
  /* Le nom du poste vit à part : restaurer la sauvegarde de la tablette sur le
     PC ne doit pas faire croire au PC qu'il est la tablette. */
  const KEY_POSTE = 'maintenance-atelier/poste';

  const VERSION = 2;
  /** Frappes successives dans le même champ : une seule entrée au journal. */
  const COALESCE_MS = 120000;

  let data = null;
  let timer = null;
  let erreur = null;
  let durable = null;
  const listeners = [];
  /** Abonnés aux mutations : sync.js, quand il y a un serveur. Personne sinon. */
  const sortants = [];
  /** Le champ que l'opérateur est en train de remplir, si l'écran en désigne
      un. L'état venu du serveur ne l'écrase pas — voir applyRemote(). */
  let champProtege = () => null;

  const emit = (s) => listeners.forEach((fn) => fn(s));
  const maintenant = () => new Date().toISOString();

  function blank() {
    const d = {
      version: VERSION, updated: null, tables: {},
      journal: [], trash: [], lastBackup: null,
    };
    for (const id of Object.keys(TABLES)) d.tables[id] = TABLES[id].seed();
    return d;
  }

  /**
   * Toute ligne porte un identifiant. Sans lui le journal ne saurait pas de
   * quelle ligne il parle : les tableaux insèrent en tête, l'indice d'une ligne
   * change dès l'ajout suivant. C'est aussi lui qui désigne la ligne d'un poste
   * à l'autre — deux navigateurs n'ont aucune raison de compter pareil.
   */
  function normalise(rows) {
    for (const r of rows) if (r && !r._id) r._id = uid();
    return rows;
  }

  function load() {
    let raw = null;
    let parsed = null;
    try {
      raw = localStorage.getItem(KEY);
      parsed = raw ? JSON.parse(raw) : null;
    } catch (e) {
      erreur = e;
      console.error('Lecture du stockage impossible.', e);
      // Un stockage illisible n'est pas un stockage vide : la chaîne brute est
      // mise de côté avant qu'on reparte, elle reste récupérable à la main.
      if (raw) { try { localStorage.setItem(KEY + '.corrompu', raw); } catch (_) { /* plein */ } }
    }

    if (!parsed || typeof parsed !== 'object') { data = blank(); return data; }

    data = {
      version: VERSION,
      updated: parsed.updated || null,
      tables: {},
      journal: Array.isArray(parsed.journal) ? parsed.journal : null,
      trash: Array.isArray(parsed.trash) ? parsed.trash : [],
      lastBackup: parsed.lastBackup || null,
    };
    // On repart du schéma courant : une table ajoutée au code apparaît sans
    // casser les données déjà saisies.
    for (const id of Object.keys(TABLES)) {
      data.tables[id] = normalise(Array.isArray(parsed.tables?.[id])
        ? parsed.tables[id]
        : TABLES[id].seed());
    }
    keepOrphans(parsed);
    for (const t of data.trash) if (t && t.row && !t.row._id) t.row._id = uid();
    ouvreJournal();
    return data;
  }

  /**
   * Une table retirée du schéma n'est pas effacée pour autant : ses lignes
   * restent dans le stockage et dans la sauvegarde .json. Elles ne sont plus
   * affichées, mais rien n'est perdu — les données de l'atelier ne sont pas
   * régénérables, et un écran peut revenir.
   */
  function keepOrphans(parsed) {
    for (const id of Object.keys(parsed.tables || {})) {
      if (!(id in data.tables) && Array.isArray(parsed.tables[id])) {
        data.tables[id] = normalise(parsed.tables[id]);
      }
    }
  }

  /**
   * Première ouverture du journal sur des données déjà saisies : l'historique
   * d'avant ne s'invente pas, on note au moins d'où l'on part.
   */
  function ouvreJournal() {
    if (Array.isArray(data.journal)) return;
    data.journal = [];
    const n = compte();
    if (n) note({ op: 'depart', resume: `${n} ligne${n > 1 ? 's' : ''} déjà consignée${n > 1 ? 's' : ''} avant l'ouverture du journal` });
  }

  const compte = () => Object.values(data.tables).reduce((s, r) => s + r.length, 0);

  /* ---------------------------------------------------------- journal ----- */

  function note(e) {
    const entree = Object.assign({ t: maintenant(), poste: api.poste() }, e);
    data.journal.push(entree);
    return entree;
  }

  /** Une écriture part vers le serveur, s'il y en a un. Sinon personne n'écoute
      et l'appel ne coûte rien. */
  const emet = (m) => sortants.forEach((fn) => fn(m));

  const valeursDe = (row) => {
    const v = {};
    for (const k of Object.keys(row)) if (k !== '_id') v[k] = row[k];
    return v;
  };

  /**
   * Étiquette courte d'une ligne, figée dans l'entrée de journal : elle doit
   * rester lisible même si la ligne change ou repart plus tard.
   */
  function libelle(tableId, row) {
    const cols = (TABLES[tableId] || {}).columns || [];
    const parts = [];
    for (const c of cols) {
      const v = String(row[c.key] ?? '').trim();
      if (!v) continue;
      parts.push(c.type === 'datetime' ? v.replace('T', ' ') : v);
      if (parts.length === 2) break;
    }
    return parts.join(' · ') || 'ligne vide';
  }

  /**
   * Une frappe par caractère ferait sept entrées pour « turbine ». Tant qu'on
   * reste dans le même champ de la même ligne, on prolonge l'entrée en cours :
   * le « avant » d'origine est conservé, seul le « après » suit la frappe.
   *
   * Renvoie une copie de l'entrée, y compris quand celle-ci vient d'être
   * retirée : l'appelant doit pouvoir dire au serveur que la valeur est revenue
   * à son point de départ.
   */
  function noteModif(id, row, key, avant, apres) {
    const last = data.journal[data.journal.length - 1];
    const suite = last && last.op === 'modif' && last.table === id
      && last.row === row._id && last.champ === key && last.mid
      && Date.now() - Date.parse(last.t) < COALESCE_MS;

    if (suite) {
      last.apres = apres;
      last.t = maintenant();
      last.resume = libelle(id, row);
      const copie = Object.assign({}, last);
      if (last.avant === last.apres) data.journal.pop(); // revenu au point de départ
      return copie;
    }
    return note({ mid: uid(), op: 'modif', table: id, row: row._id, champ: key, avant, apres, resume: libelle(id, row) });
  }

  /* ------------------------------------------------------- persistance ---- */

  function persist() {
    const precedent = data.updated;
    data.updated = maintenant();
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      // Écrire a échoué : l'horodatage ne doit pas prétendre le contraire.
      data.updated = precedent;
      erreur = e;
      console.error('Écriture impossible.', e);
      emit('error');
      return false;
    }
    erreur = null;
    emit('saved');
    return true;
  }

  /** Écriture différée : la frappe reste fluide, l'écriture se fait au repos. */
  function touch() {
    emit(erreur ? 'error' : 'dirty');
    clearTimeout(timer);
    timer = setTimeout(persist, 350);
  }

  function flush() {
    clearTimeout(timer);
    timer = null;
    persist();
  }

  /**
   * Chrome vide le stockage d'un site « non persistant » quand la tablette
   * manque de place. On demande l'exemption au démarrage — c'est un diagnostic,
   * jamais bloquant : un refus n'empêche rien, il se lit dans le rail.
   */
  async function durabilite() {
    const st = navigator.storage;
    const out = { durable: null, usage: null, quota: null };
    try {
      if (st && st.persist) {
        out.durable = (st.persisted ? await st.persisted() : false) || await st.persist();
      }
      if (st && st.estimate) {
        const e = await st.estimate();
        out.usage = e.usage;
        out.quota = e.quota;
      }
    } catch (_) { /* diagnostic seulement */ }
    durable = out.durable;
    return out;
  }

  /* -------------------------------------------------------- fusion -------- */

  /* Le `mid` identifie une écriture d'un bout à l'autre de la chaîne : il suit
     la même entrée du navigateur au serveur puis aux autres postes. Les entrées
     d'avant le partage n'en ont pas — on retombe alors sur leur contenu. */
  const cleEntree = (e) => e.mid || [e.t, e.op, e.table, e.row, e.champ, e.apres].join('|');

  /**
   * Le journal est fusionné, jamais remplacé : restaurer une sauvegarde ou
   * recevoir l'état du serveur ne doit pas effacer ce que ce poste a consigné
   * entre-temps. Les entrées sont horodatées, l'ordre se refait tout seul.
   */
  function fusionneJournal(entrees) {
    if (!Array.isArray(entrees)) return 0;
    const vus = new Map();
    data.journal.forEach((e, i) => vus.set(cleEntree(e), i));
    let n = 0;
    for (const e of entrees) {
      if (!e || typeof e !== 'object') continue;
      const cle = cleEntree(e);
      const connu = vus.get(cle);
      if (connu !== undefined) {
        // Même écriture des deux côtés : la version la plus récente gagne. Une
        // frappe en cours ici est plus à jour que ce que le serveur a reçu.
        const place = data.journal[connu];
        if (String(e.t) > String(place.t)) data.journal[connu] = e;
        continue;
      }
      vus.set(cle, data.journal.length);
      data.journal.push(e);
      n++;
    }
    data.journal.sort((a, b) => String(a.t).localeCompare(String(b.t)));
    return n;
  }

  function fusionneCorbeille(items) {
    if (!Array.isArray(items)) return 0;
    const vus = new Set(data.trash.map((t) => t && t.row && t.row._id));
    let n = 0;
    for (const t of items) {
      if (!t || !t.row) continue;
      if (!t.row._id) t.row._id = uid();
      if (vus.has(t.row._id)) continue;
      vus.add(t.row._id);
      data.trash.push(t);
      n++;
    }
    return n;
  }

  /* ------------------------------------------------------ lignes ---------- */

  const indexDe = (id, rowId) => api.rows(id).findIndex((r) => r && r._id === rowId);
  const indexCorbeille = (rowId) => data.trash.findIndex((t) => t && t.row && t.row._id === rowId);

  /** Toutes les lignes connues du poste, tableaux et corbeille confondus. */
  function toutesLesLignes() {
    const out = [];
    for (const id of Object.keys(data.tables)) {
      for (const r of data.tables[id]) if (r && r._id) out.push({ table: id, row: r });
    }
    return out;
  }

  /* ------------------------------------------------------------- API ------ */

  const api = {
    init() { load(); return api; },
    onState(fn) { listeners.push(fn); },
    /** sync.js s'abonne ici pour envoyer les écritures au serveur. */
    onMutation(fn) { sortants.push(fn); },
    /** L'écran déclare le champ en cours de frappe : le serveur ne l'écrase pas. */
    protege(fn) { champProtege = fn || (() => null); },
    all() { return data; },
    rows(id) { return data.tables[id] || (data.tables[id] = []); },
    row(id, rowId) { return api.rows(id).find((r) => r && r._id === rowId) || null; },
    compte,
    durabilite,
    durable() { return durable; },
    erreur() { return erreur; },
    journal() { return data.journal; },
    trash() { return data.trash; },
    libelle,

    poste() {
      try { return localStorage.getItem(KEY_POSTE) || ''; } catch (_) { return ''; }
    },
    setPoste(v) {
      try { localStorage.setItem(KEY_POSTE, String(v || '').slice(0, 24)); } catch (_) { /* stockage bloqué */ }
    },

    /* Les lignes se désignent par leur identifiant, jamais par leur rang : sur
       un tableau partagé, l'ajout d'un collègue décale les indices d'un poste
       sans prévenir l'autre. */

    set(id, rowId, key, value) {
      const r = api.row(id, rowId);
      if (!r) return;
      const avant = String(r[key] ?? '');
      if (avant === String(value)) return;
      r[key] = String(value);
      const e = noteModif(id, r, key, avant, String(value));
      emet({
        mid: e.mid, op: 'modif', table: id, row: r._id, champ: key,
        avant: e.avant, apres: e.apres, t: e.t, poste: e.poste, resume: e.resume,
      });
      touch();
    },

    /** `prepend` place la ligne en tête, comme le demande le schéma du tableau. */
    add(id, row, prepend) {
      const r = Object.assign({ _id: uid() }, row || {});
      if (prepend) api.rows(id).unshift(r); else api.rows(id).push(r);
      const e = note({ mid: uid(), op: 'ajout', table: id, row: r._id, resume: libelle(id, r) });
      emet({
        mid: e.mid, op: 'ajout', table: id, row: r._id, valeurs: valeursDe(r),
        prepend: !!prepend, t: e.t, poste: e.poste, resume: e.resume,
      });
      flush();
      return r;
    },

    /** La ligne quitte le tableau mais reste dans le fichier : elle part à la
        corbeille, d'où elle se remet en place. Aucune suppression sèche. */
    remove(id, rowId) {
      const i = indexDe(id, rowId);
      if (i < 0) return null;
      const [row] = api.rows(id).splice(i, 1);
      const e = note({ mid: uid(), op: 'corbeille', table: id, row: row._id, resume: libelle(id, row) });
      data.trash.push({ table: id, row, at: e.t, poste: e.poste });
      emet({ mid: e.mid, op: 'corbeille', table: id, row: row._id, t: e.t, poste: e.poste, resume: e.resume });
      flush();
      return row;
    },

    /** Remet une ligne de la corbeille dans son tableau d'origine. */
    untrash(rowId) {
      const i = indexCorbeille(rowId);
      if (i < 0) return null;
      const [t] = data.trash.splice(i, 1);
      const spec = TABLES[t.table];
      const prepend = !!(spec && spec.prepend);
      if (prepend) api.rows(t.table).unshift(t.row); else api.rows(t.table).push(t.row);
      const e = note({ mid: uid(), op: 'restauration', table: t.table, row: t.row._id, resume: libelle(t.table, t.row) });
      emet({ mid: e.mid, op: 'restauration', table: t.table, row: t.row._id, prepend, t: e.t, poste: e.poste, resume: e.resume });
      flush();
      return t;
    },

    updatedAt() { return data.updated ? new Date(data.updated) : null; },
    backupAt() { return data.lastBackup ? new Date(data.lastBackup) : null; },

    /** Âge de la dernière sauvegarde en jours pleins, null si jamais faite. */
    backupAge() {
      if (!data.lastBackup) return null;
      return Math.floor((Date.now() - Date.parse(data.lastBackup)) / 86400000);
    },

    /* ------------------------------------------------------- partage ---- */

    /**
     * L'état venu du serveur remplace les tableaux et la corbeille : c'est lui
     * qui fait autorité entre les postes. Le journal, lui, est fusionné —
     * l'historique ne recule jamais.
     *
     * Deux précautions. Le champ en cours de frappe garde sa valeur locale,
     * sinon la saisie s'effacerait sous les doigts à l'instant où la réponse
     * arrive. Et les écritures encore en attente d'envoi sont rejouées par
     * `rejoue()` juste après : l'écran ne clignote pas en revenant en arrière
     * une fraction de seconde.
     */
    applyRemote(payload) {
      if (!payload || !payload.tables) return false;
      const garde = champProtege();
      const gardeValeur = garde ? (api.row(garde.table, garde.row) || {})[garde.champ] : undefined;

      for (const id of Object.keys(payload.tables)) {
        if (Array.isArray(payload.tables[id])) data.tables[id] = normalise(payload.tables[id]);
      }
      // Une table connue du schéma mais absente du serveur est simplement vide.
      for (const id of Object.keys(TABLES)) if (!Array.isArray(data.tables[id])) data.tables[id] = [];
      if (Array.isArray(payload.trash)) {
        data.trash = payload.trash;
        for (const t of data.trash) if (t && t.row && !t.row._id) t.row._id = uid();
      }
      if (garde && gardeValeur !== undefined) {
        const r = api.row(garde.table, garde.row);
        if (r) r[garde.champ] = gardeValeur;
      }
      fusionneJournal(payload.journal);
      flush();
      return true;
    },

    /** Rejoue localement les mutations pas encore acquittées par le serveur. */
    rejoue(mutations) {
      if (!Array.isArray(mutations) || !mutations.length) return;
      for (const m of mutations) appliqueLocal(m);
      flush();
    },

    /**
     * Les lignes que le serveur ne connaît pas encore, sous forme de mutations
     * prêtes à partir. C'est ce qui amorce le partage sur un poste déjà rempli,
     * et ce qui rattrape une saisie faite hors ligne dont l'envoi s'est perdu.
     */
    aEnvoyer(connuesParLeServeur) {
      const out = [];
      for (const { table, row } of toutesLesLignes()) {
        if (connuesParLeServeur.has(row._id)) continue;
        const spec = TABLES[table];
        out.push({
          mid: uid(), op: 'ajout', table, row: row._id, valeurs: valeursDe(row),
          prepend: !!(spec && spec.prepend), t: maintenant(), poste: api.poste(),
          resume: libelle(table, row),
        });
      }
      for (const t of data.trash) {
        if (!t || !t.row || connuesParLeServeur.has(t.row._id)) continue;
        const spec = TABLES[t.table];
        // La ligne doit exister avant de pouvoir partir à la corbeille.
        out.push({
          mid: uid(), op: 'ajout', table: t.table, row: t.row._id, valeurs: valeursDe(t.row),
          prepend: !!(spec && spec.prepend), t: t.at || maintenant(), poste: t.poste || api.poste(),
          resume: libelle(t.table, t.row),
        });
        out.push({
          mid: uid(), op: 'corbeille', table: t.table, row: t.row._id,
          t: t.at || maintenant(), poste: t.poste || api.poste(), resume: libelle(t.table, t.row),
        });
      }
      return out;
    },

    /* ------------------------------------------------------ sauvegarde -- */

    /** Le fichier contient tout : tableaux, journal et corbeille. */
    backup(prefixe) {
      flush();
      const stamp = maintenant().slice(0, 16).replace(/[:T]/g, '-');
      const nom = `${prefixe || 'maintenance-atelier'}-${stamp}.json`;
      download(nom, JSON.stringify(data, null, 2), 'application/json');
      data.lastBackup = maintenant();
      note({ op: 'sauvegarde', resume: nom });
      flush();
      return nom;
    },

    /**
     * Les tableaux sont remplacés par ceux du fichier — c'est l'attendu quand on
     * remonte une sauvegarde sur un poste réinitialisé. Le journal et la
     * corbeille, eux, sont fusionnés : l'historique ne recule jamais.
     * L'appelant télécharge l'état courant avant d'appeler, pendant le geste de
     * l'opérateur (un téléchargement différé se ferait bloquer).
     *
     * Avec le partage actif, la synchronisation qui suit renvoie au serveur les
     * lignes qu'il ne connaissait pas. Elle ne rétablit pas d'anciennes valeurs
     * sur des lignes que le serveur a déjà : remonter une vieille sauvegarde ne
     * fait pas reculer le travail des autres postes.
     */
    restore(file) {
      return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => {
          try {
            const parsed = JSON.parse(fr.result);
            if (!parsed || typeof parsed !== 'object' || !parsed.tables) {
              throw new Error('Fichier de sauvegarde non reconnu.');
            }
            for (const id of Object.keys(TABLES)) {
              data.tables[id] = normalise(Array.isArray(parsed.tables[id])
                ? parsed.tables[id]
                : TABLES[id].seed());
            }
            keepOrphans(parsed);
            const nj = fusionneJournal(parsed.journal);
            const nc = fusionneCorbeille(parsed.trash);
            note({
              op: 'import',
              resume: `${compte()} ligne(s) en place · ${nj} entrée(s) d'historique et ${nc} ligne(s) de corbeille reprises`,
            });
            flush();
            resolve({ lignes: compte(), journal: nj, corbeille: nc });
          } catch (e) { reject(e); }
        };
        fr.onerror = () => reject(fr.error);
        fr.readAsText(file);
      });
    },

    /* ------------------------------------------------------------- CSV -- */

    /** CSV séparé par « ; » + BOM : s'ouvre directement dans Excel FR. */
    exportCsv(id) {
      const cols = TABLES[id].columns;
      const lines = [cols.map((c) => csv(c.label)).join(';')];
      for (const row of api.rows(id)) {
        // Le T de datetime-local n'est pas lu comme une date par Excel :
        // « 2026-08-11 10:54 » l'est.
        lines.push(cols.map((c) => csv(
          c.type === 'datetime' ? String(row[c.key] ?? '').replace('T', ' ') : row[c.key]
        )).join(';'));
      }
      telecharge(`${id}-${today()}.csv`, lines);
    },

    /** Le journal s'exporte comme un tableau : mêmes libellés qu'à l'écran. */
    exportJournal(cols, valeur) {
      const lines = [cols.map((c) => csv(c.label)).join(';')];
      for (const e of data.journal) {
        lines.push(cols.map((c) => csv(valeur(e, c.key))).join(';'));
      }
      telecharge(`historique-${today()}.csv`, lines);
    },
  };

  /**
   * Applique une mutation aux tableaux sans rien consigner : elle l'a déjà été
   * quand l'opérateur l'a faite. Sert au rejeu des écritures en attente
   * par-dessus l'état revenu du serveur.
   */
  function appliqueLocal(m) {
    if (!m || !m.op) return;
    switch (m.op) {
      case 'ajout': {
        if (api.row(m.table, m.row) || indexCorbeille(m.row) >= 0) return;
        const r = Object.assign({ _id: m.row }, m.valeurs || {});
        if (m.prepend) api.rows(m.table).unshift(r); else api.rows(m.table).push(r);
        return;
      }
      case 'modif': {
        const r = api.row(m.table, m.row);
        if (r) r[m.champ] = m.apres;
        return;
      }
      case 'corbeille': {
        const i = indexDe(m.table, m.row);
        if (i < 0) return;
        const [row] = api.rows(m.table).splice(i, 1);
        data.trash.push({ table: m.table, row, at: m.t, poste: m.poste });
        return;
      }
      case 'restauration': {
        const i = indexCorbeille(m.row);
        if (i < 0) return;
        const [t] = data.trash.splice(i, 1);
        if (m.prepend) api.rows(t.table).unshift(t.row); else api.rows(t.table).push(t.row);
        return;
      }
      default:
    }
  }

  const csv = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  /** BOM UTF-8 en tête : sans lui Excel FR lit les accents de travers. */
  const BOM = '\uFEFF';
  const telecharge = (nom, lines) =>
    download(nom, BOM + lines.join('\r\n'), 'text/csv;charset=utf-8');

  function download(name, content, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  window.addEventListener('beforeunload', () => { if (timer) flush(); });

  return api;
})();
