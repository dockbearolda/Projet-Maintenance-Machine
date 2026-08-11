/* =========================================================================
   SCHEMA — les trois tableaux de l'atelier, leurs colonnes, leur navigation.
   Un seul endroit à modifier pour ajouter une machine ou une colonne.
   ========================================================================= */

/** Date locale au format YYYY-MM-DD (toISOString décalerait d'un jour en UTC+n). */
function ymdLocal(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function today() { return ymdLocal(new Date()); }

/* --- tables -------------------------------------------------------------- */

/* Colonnes des deux journaux de pièces : la DTF et la Roland UV se remplissent
   pareil, on écrit la liste une fois. */
/* Les largeurs servent aussi de proportions sur tablette en portrait : la
   colonne Date garde de quoi afficher jj/mm/aaaa et son icône de calendrier
   même une fois tout ramené à l'écran. */
const COLONNES_PIECES = [
  { key: 'date', label: 'Date',       type: 'date', w: 186, stick: true },
  { key: 'piece', label: 'Pièce',     type: 'text', w: 220 },
  { key: 'qte',  label: 'Qté',        type: 'num',  w: 64 },
  { key: 'cout', label: 'Coût (€)',   type: 'num',  w: 94 },
  { key: 'tech', label: 'Technicien', type: 'text', w: 134 },
  { key: 'obs',  label: 'Remarques',  type: 'long', w: 214 },
];

const TABLES = {

  /* --------------------------------------------------- TROTEC — LASER --- */
  trotec_nettoyage: {
    id: 'trotec_nettoyage',
    machine: 'Trotec — laser',
    title: 'Nettoyages complets',
    subtitle: 'Une ligne = un nettoyage complet. La date du jour est déjà remplie.',
    rowLabel: 'nettoyage',
    prepend: true,
    addRow: () => ({ date: today() }),
    columns: [
      { key: 'date', label: 'Date',       type: 'date', w: 186, stick: true },
      { key: 'tech', label: 'Technicien', type: 'text', w: 190 },
      { key: 'obs',  label: 'Remarques',  type: 'long', w: 560 },
    ],
    seed: () => [],
  },

  /* ------------------------------------------------- SUBLISTAR DTF ------ */
  dtf_pieces: {
    id: 'dtf_pieces',
    machine: 'Sublistar DTF',
    title: 'Changements de pièces',
    subtitle: 'Une ligne = une pièce changée. La date du jour est déjà remplie.',
    rowLabel: 'changement',
    prepend: true,
    addRow: () => ({ date: today() }),
    columns: COLONNES_PIECES,
    seed: () => [],
  },

  /* ----------------------------------------------------- ROLAND UV ----- */
  roland_pieces: {
    id: 'roland_pieces',
    machine: 'Roland UV',
    title: 'Changements de pièces',
    subtitle: 'Une ligne = une pièce changée. La date du jour est déjà remplie.',
    rowLabel: 'changement',
    prepend: true,
    addRow: () => ({ date: today() }),
    columns: COLONNES_PIECES,
    seed: () => [],
  },
};

/* --- navigation ---------------------------------------------------------- */

const NAV = [
  {
    label: null,
    items: [
      { id: 'trotec_nettoyage', label: 'Trotec — nettoyages' },
      { id: 'dtf_pieces', label: 'DTF — pièces' },
      { id: 'roland_pieces', label: 'Roland UV — pièces' },
    ],
  },
];

/** Écran ouvert au démarrage et repli de toute URL inconnue. */
const ACCUEIL = 'trotec_nettoyage';
