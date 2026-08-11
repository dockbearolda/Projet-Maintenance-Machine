/* =========================================================================
   SCHEMA — les trois tableaux de l'atelier, leurs colonnes, leur navigation.
   Un seul endroit à modifier pour ajouter une machine ou une colonne.
   ========================================================================= */

/**
 * Identifiant de ligne. Stable, il survit aux insertions en tête, aux tris et
 * aux allers-retours par la sauvegarde .json : c'est lui qui relie une ligne à
 * son historique. randomUUID demande https ou localhost, d'où le repli.
 */
function uid() {
  if (self.crypto && self.crypto.randomUUID) return self.crypto.randomUUID();
  return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

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
    // Entretien périodique propre au laser : le bandeau dit quand il retombe,
    // le bouton consigne la ligne avec le bon libellé. Faute de colonne dédiée
    // ici, c'est la colonne Remarques qui sert de repère.
    rappel: {
      titre: 'Nettoyage de la turbine',
      mois: 6,
      cle: 'obs',
      motCle: 'turbine',
      valeur: 'Nettoyage turbine',
    },
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

/* --- écrans de suivi ------------------------------------------------------
   Ils ne se saisissent pas : ils donnent à voir ce que le store a conservé.
   Déclarés ici comme les tableaux pour que la navigation tienne dans un seul
   fichier ; `vue` désigne le rendu correspondant dans app.js. */

const ECRANS = {

  journal: {
    id: 'journal',
    machine: 'Suivi',
    title: 'Historique',
    subtitle: 'Chaque écriture, dans l’ordre, avec la valeur d’avant. Rien ne s’y modifie, rien ne s’en efface.',
    vue: 'journal',
    // Somme ≈ 1000 px : l'historique tient sans défilement latéral sur la
    // tablette en paysage (1280 moins le rail et les marges). Les valeurs trop
    // longues passent à la ligne au lieu d'élargir la colonne — l'opérateur en
    // gants ne peut pas survoler pour lire une infobulle.
    columns: [
      { key: 't',      label: 'Quand',  w: 150, stick: true },
      { key: 'table',  label: 'Écran',  w: 105 },
      { key: 'op',     label: 'Action', w: 128 },
      { key: 'resume', label: 'Ligne',  w: 190 },
      { key: 'champ',  label: 'Champ',  w: 88 },
      { key: 'avant',  label: 'Avant',  w: 128 },
      { key: 'apres',  label: 'Après',  w: 128 },
      { key: 'poste',  label: 'Poste',  w: 82 },
    ],
  },

  corbeille: {
    id: 'corbeille',
    machine: 'Suivi',
    title: 'Corbeille',
    subtitle: 'Les lignes retirées des tableaux. Elles restent dans le fichier et se remettent en place d’un bouton.',
    vue: 'corbeille',
  },
};

/** Libellés d'action du journal. Le ton colore la ligne à l'écran. */
const OPS = {
  ajout:        { label: 'Ajout',           t: 'ok' },
  modif:        { label: 'Modification',    t: '' },
  corbeille:    { label: 'Corbeille',       t: 'bad' },
  restauration: { label: 'Remise en place', t: 'ok' },
  import:       { label: 'Restauration',    t: 'warn' },
  sauvegarde:   { label: 'Sauvegarde',      t: 'ok' },
  depart:       { label: 'Ouverture',       t: '' },
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
  {
    label: 'Suivi',
    items: [
      { id: 'journal', label: 'Historique' },
      { id: 'corbeille', label: 'Corbeille' },
    ],
  },
];

/** Écran ouvert au démarrage et repli de toute URL inconnue. */
const ACCUEIL = 'trotec_nettoyage';
