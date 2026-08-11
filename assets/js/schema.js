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

/** Date + heure locales au format attendu par <input type="datetime-local">. */
function nowLocal() {
  const d = new Date();
  return ymdLocal(d) + 'T' +
    String(d.getHours()).padStart(2, '0') + ':' +
    String(d.getMinutes()).padStart(2, '0');
}

/* --- tables -------------------------------------------------------------- */

/* Colonnes des deux journaux de pièces : la DTF et la Roland UV se remplissent
   pareil, on écrit la liste une fois.
   Les largeurs servent aussi de proportions sur tablette en portrait : la
   colonne Date et heure garde de quoi afficher jj/mm/aaaa hh:mm et son icône
   même une fois tout ramené à l'écran. */
const COLONNES_PIECES = [
  { key: 'date', label: 'Date et heure', type: 'datetime', w: 280, stick: true },
  { key: 'piece', label: 'Pièce',        type: 'text', w: 230 },
  { key: 'qte',  label: 'Qté',           type: 'num',  w: 68 },
  { key: 'tech', label: 'Technicien',    type: 'text', w: 145 },
  { key: 'obs',  label: 'Remarques',     type: 'long', w: 210 },
];

const TABLES = {

  /* --------------------------------------------------- TROTEC — LASER --- */
  trotec_nettoyage: {
    id: 'trotec_nettoyage',
    machine: 'Trotec — laser',
    title: 'Nettoyages complets',
    subtitle: 'Une ligne = un nettoyage complet. La date et l’heure sont déjà remplies.',
    rowLabel: 'nettoyage',
    prepend: true,
    addRow: () => ({ date: nowLocal() }),
    columns: [
      { key: 'date', label: 'Date et heure', type: 'datetime', w: 280, stick: true },
      { key: 'tech', label: 'Technicien',    type: 'text', w: 190 },
      { key: 'obs',  label: 'Remarques',     type: 'long', w: 470 },
    ],
    seed: () => [],
  },

  /* ------------------------------------------------- SUBLISTAR DTF ------ */
  dtf_pieces: {
    id: 'dtf_pieces',
    machine: 'Sublistar DTF',
    title: 'Changements de pièces',
    subtitle: 'Une ligne = une pièce changée. La date et l’heure sont déjà remplies.',
    rowLabel: 'changement',
    prepend: true,
    addRow: () => ({ date: nowLocal() }),
    columns: COLONNES_PIECES,
    // Entretien périodique propre à cette machine : le bandeau dit quand il
    // retombe, le bouton consigne la ligne avec le bon libellé.
    rappel: {
      titre: 'Nettoyage de la turbine',
      mois: 6,
      cle: 'piece',
      motCle: 'turbine',
      valeur: 'Nettoyage turbine',
    },
    seed: () => [],
  },

  /* ----------------------------------------------------- ROLAND UV ----- */
  roland_pieces: {
    id: 'roland_pieces',
    machine: 'Roland UV',
    title: 'Changements de pièces',
    subtitle: 'Une ligne = une pièce changée. La date et l’heure sont déjà remplies.',
    rowLabel: 'changement',
    prepend: true,
    addRow: () => ({ date: nowLocal() }),
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
