/* =========================================================================
   STORE — persistance locale, sauvegarde/restauration, export CSV.
   Aucune dépendance, aucun serveur : tout vit dans le navigateur du poste.
   ========================================================================= */

const Store = (() => {
  const KEY = 'maintenance-atelier/v1';
  let data = null;
  let timer = null;
  const listeners = [];

  function blank() {
    const d = { version: 1, updated: null, tables: {} };
    for (const id of Object.keys(TABLES)) d.tables[id] = TABLES[id].seed();
    return d;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return (data = blank());
      const parsed = JSON.parse(raw);
      data = { version: 1, updated: parsed.updated || null, tables: {} };
      // On repart du schéma courant : une table ajoutée au code apparaît sans
      // casser les données déjà saisies.
      for (const id of Object.keys(TABLES)) {
        data.tables[id] = Array.isArray(parsed.tables?.[id])
          ? parsed.tables[id]
          : TABLES[id].seed();
      }
      keepOrphans(parsed);
    } catch (e) {
      console.error('Lecture du stockage impossible, réinitialisation.', e);
      data = blank();
    }
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
        data.tables[id] = parsed.tables[id];
      }
    }
  }

  function persist() {
    data.updated = new Date().toISOString();
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      console.error(e);
      return { ok: false, error: e };
    }
    listeners.forEach((fn) => fn('saved'));
    return { ok: true };
  }

  /** Écriture différée : la frappe reste fluide, l'écriture se fait au repos. */
  function touch() {
    listeners.forEach((fn) => fn('dirty'));
    clearTimeout(timer);
    timer = setTimeout(persist, 350);
  }

  function flush() {
    clearTimeout(timer);
    persist();
  }

  const api = {
    init() { load(); return api; },
    onState(fn) { listeners.push(fn); },
    all() { return data; },
    rows(id) { return data.tables[id] || (data.tables[id] = []); },

    set(id, index, key, value) {
      const r = api.rows(id)[index];
      if (!r) return;
      r[key] = value;
      touch();
    },

    add(id, row) {
      api.rows(id).push(row || {});
      flush();
      return api.rows(id).length - 1;
    },

    remove(id, index) {
      const [row] = api.rows(id).splice(index, 1);
      flush();
      return row;
    },

    insert(id, index, row) {
      api.rows(id).splice(index, 0, row);
      flush();
    },

    updatedAt() { return data.updated ? new Date(data.updated) : null; },

    /* ------------------------------------------------------ sauvegarde -- */

    backup() {
      flush();
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      download(
        `maintenance-atelier-${stamp}.json`,
        JSON.stringify(data, null, 2),
        'application/json'
      );
    },

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
              data.tables[id] = Array.isArray(parsed.tables[id])
                ? parsed.tables[id]
                : TABLES[id].seed();
            }
            keepOrphans(parsed);
            flush();
            resolve();
          } catch (e) { reject(e); }
        };
        fr.onerror = () => reject(fr.error);
        fr.readAsText(file);
      });
    },

    /** CSV séparé par « ; » + BOM : s'ouvre directement dans Excel FR. */
    exportCsv(id) {
      const spec = TABLES[id];
      const cols = spec.columns;
      const esc = (v) => {
        const s = String(v ?? '');
        return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const lines = [cols.map((c) => esc(c.label)).join(';')];
      for (const row of api.rows(id)) {
        // Le T de datetime-local n'est pas lu comme une date par Excel :
        // « 2026-08-11 10:54 » l'est.
        lines.push(cols.map((c) => esc(
          c.type === 'datetime' ? String(row[c.key] ?? '').replace('T', ' ') : row[c.key]
        )).join(';'));
      }
      download(
        `${id}-${today()}.csv`,
        '\uFEFF' + lines.join('\r\n'),
        'text/csv;charset=utf-8'
      );
    },
  };

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
