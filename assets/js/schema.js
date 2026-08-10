/* =========================================================================
   SCHEMA — définition des sections, des colonnes et des données d'amorçage.
   Source : Maintenance_Trotec_DTF_1.xlsx (source/).
   Un seul endroit à modifier pour ajouter une machine, un poste ou une colonne.
   ========================================================================= */

const TRI = ['', 'OK', 'NOK', 'N-A'];

/* --- helpers d'amorçage -------------------------------------------------- */

/** Date locale au format YYYY-MM-DD (toISOString décalerait d'un jour en UTC+n). */
function ymdLocal(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function today() { return ymdLocal(new Date()); }

function nowLocal() {
  const d = new Date();
  return ymdLocal(d) + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}

/** 52 lundis à partir du 10/08/2026 (reprise du calendrier du classeur). */
function seedWeeks() {
  const rows = [];
  const d = new Date(2026, 7, 10);
  for (let i = 0; i < 52; i++) {
    rows.push({ sem: String(isoWeek(d)), date: ymdLocal(d) });
    d.setDate(d.getDate() + 7);
  }
  return rows;
}

/* --- postes de contrôle hebdo Trotec ------------------------------------- */

const POSTES = [
  ['lentille',  'Lentille de focalisation',   'Lentille',      'Optique'],
  ['miroirs',   'Miroirs 1 / 2 / 3',          'Miroirs',       'Optique'],
  ['fenetre',   'Fenêtre de sortie du tube',  'Fenêtre tube',  'Optique'],
  ['rails',     'Rails + guidages X/Y',       'Rails X/Y',     'Mécanique'],
  ['courroies', 'Courroies (tension/usure)',  'Courroies',     'Mécanique'],
  ['nid',       "Table nid d'abeille",        "Nid d'abeille", 'Mécanique'],
  ['tiroir',    'Tiroir à déchets',           'Tiroir déchets','Mécanique'],
  ['buse',      "Buse d'assistance d'air",    'Buse air',      'Air / extraction'],
  ['filtre',    "Filtre d'extraction (état)", 'Filtre extr.',  'Air / extraction'],
  ['ventilos',  'Ventilateurs + grilles',     'Ventilos',      'Air / extraction'],
  ['capot',     'Capot + vitre',              'Capot / vitre', 'Contrôles & sécurité'],
  ['capteurs',  'Capteurs / fins de course',  'Capteurs',      'Contrôles & sécurité'],
  ['aru',       "Arrêt d'urgence (test)",     'Arrêt urg.',    'Contrôles & sécurité'],
  ['secucapot', 'Sécurité capot (test)',      'Sécu capot',    'Contrôles & sécurité'],
  ['testcoupe', 'Test de coupe de référence', 'Test coupe',    'Contrôles & sécurité'],
];

const POSTE_KEYS = POSTES.map((p) => p[0]);

/* --- calculs ------------------------------------------------------------- */

const CALC = {
  /** Conformité d'une semaine de pointage. */
  conformite(row) {
    const vals = POSTE_KEYS.map((k) => row[k] || '');
    if (vals.some((v) => v === 'NOK')) return { text: 'NON CONFORME', tone: 'bad' };
    if (vals.every((v) => v !== '')) return { text: 'CONFORME', tone: 'ok' };
    if (vals.some((v) => v !== '')) return { text: 'EN COURS', tone: 'warn' };
    return { text: '—', tone: 'mute' };
  },

  /** Prochaine échéance = dernier remplacement + durée de vie (mois). */
  echeance(row) {
    const mois = parseFloat(row.dureeMois);
    if (!row.dernier || !mois) return { text: '—', tone: 'mute' };
    const d = new Date(row.dernier + 'T00:00:00');
    if (isNaN(d)) return { text: '—', tone: 'mute' };
    d.setMonth(d.getMonth() + Math.round(mois));
    return { text: ymdLocal(d), tone: 'mute', raw: d };
  },

  /** Statut d'une pièce d'usure, dérivé de l'échéance. */
  statut(row) {
    const mois = parseFloat(row.dureeMois);
    if (!mois) return { text: 'SUR CONSO.', tone: 'mute' };
    if (!row.dernier) return { text: 'À RENSEIGNER', tone: 'warn' };
    const e = CALC.echeance(row);
    if (!e.raw) return { text: 'À RENSEIGNER', tone: 'warn' };
    const jours = Math.round((e.raw - new Date().setHours(0, 0, 0, 0)) / 86400000);
    if (jours < 0) return { text: 'EN RETARD', tone: 'bad', jours };
    if (jours <= 30) return { text: 'À PRÉVOIR', tone: 'warn', jours };
    return { text: 'OK', tone: 'ok', jours };
  },

  /** Alerte de stock face au seuil mini. */
  alerte(row) {
    const s = parseFloat(row.stock);
    const q = parseFloat(row.seuil);
    if (isNaN(s) || isNaN(q)) return { text: '—', tone: 'mute' };
    if (s <= q) return { text: 'COMMANDER', tone: 'bad' };
    if (s <= q * 1.5) return { text: 'LIMITE', tone: 'warn' };
    return { text: 'OK', tone: 'ok' };
  },
};

/* --- tables -------------------------------------------------------------- */

const TABLES = {

  /* ---------------------------------------------------- TROTEC — HEBDO -- */
  trotec_hebdo: {
    id: 'trotec_hebdo',
    machine: 'Trotec — laser',
    title: 'Pointage hebdomadaire',
    subtitle: '1 ligne = 1 semaine. Cliquer une case pour cycler OK → NOK → N-A. Toute case NOK impose de remplir la colonne Anomalie.',
    rowLabel: 'semaine',
    addRow: () => ({ sem: String(isoWeek(new Date())), date: today() }),
    flag: (r) => POSTE_KEYS.some((k) => r[k] === 'NOK'),
    columns: [
      { key: 'sem',  label: 'Sem.',       type: 'text', w: 58,  stick: true, mono: true, group: 'Semaine' },
      { key: 'date', label: 'Date',       type: 'date', w: 138, stick: true, group: 'Semaine' },
      { key: 'tech', label: 'Technicien', type: 'text', w: 130, group: 'Semaine' },
      ...POSTES.map(([key, label, short, group]) => ({
        key, label, short, group, type: 'tri', w: 78,
      })),
      { key: '_conf',   label: 'Conformité', type: 'calc', calc: CALC.conformite, w: 132, group: 'Bilan' },
      { key: 'duree',   label: 'Durée (min)', type: 'num', w: 92,  group: 'Bilan' },
      { key: 'anomalie',label: 'Anomalie constatée / action', type: 'long', w: 340, group: 'Bilan' },
      { key: 'visa',    label: 'Visa',      type: 'text', w: 96,  group: 'Bilan' },
    ],
    seed: seedWeeks,
  },

  /* ------------------------------------------------ TROTEC — PROCÉDURE -- */
  trotec_procedure: {
    id: 'trotec_procedure',
    machine: 'Trotec — laser',
    title: 'Procédure de nettoyage',
    subtitle: "Machine à l'arrêt, sectionneur coupé, machine refroidie. Ne jamais toucher une optique à main nue.",
    rowLabel: 'poste',
    addRow: () => ({ n: '', poste: '', freq: 'Hebdo' }),
    columns: [
      { key: 'n',        label: '#',                     type: 'text', w: 52, stick: true, mono: true },
      { key: 'poste',    label: 'Poste',                 type: 'text', w: 210, stick: true },
      { key: 'faire',    label: "Ce qu'il faut faire",   type: 'long', w: 430 },
      { key: 'produit',  label: 'Produit / outil',       type: 'long', w: 250 },
      { key: 'controle', label: 'Point de contrôle',     type: 'long', w: 250 },
      { key: 'freq',     label: 'Fréq.',                 type: 'select', options: ['Hebdo', 'Mensuel', 'Trimestriel', 'Annuel', 'Selon usure'], w: 118 },
      { key: 'duree',    label: 'Durée',                 type: 'text', w: 84, mono: true },
    ],
    seed: () => [
      ['1', 'Lentille de focalisation', 'Déposer la lentille, souffler la poussière, nettoyer en spirale du centre vers le bord, sans appuyer. Sécher.', 'Alcool isopropylique 99% + coton-tige optique', 'Aucune trace ni halo en lumière rasante', 'Hebdo', '10 min'],
      ['2', 'Miroirs 1 / 2 / 3', 'Même méthode que la lentille. Ne jamais frotter. Un coton neuf par miroir.', 'Alcool isopropylique 99% + coton optique', 'Surface uniforme, pas de rayure ni piqûre', 'Hebdo', '15 min'],
      ['3', 'Fenêtre de sortie du tube', 'Dépoussiérer à la soufflette, nettoyage doux si dépôt.', 'Soufflette + coton optique', 'Pas de dépôt brun', 'Hebdo', '5 min'],
      ['4', 'Rails et guidages X/Y', "Essuyer les rails sur toute la course. Lubrifier UNIQUEMENT si le constructeur le prescrit.", 'Chiffon non pelucheux sec', 'Déplacement chariot sans point dur', 'Hebdo', '10 min'],
      ['5', 'Courroies', 'Contrôler tension et dents. Retirer les débris coincés.', 'Visuel + pinceau', 'Aucune dent manquante, pas de jeu latéral', 'Hebdo', '5 min'],
      ['6', "Table nid d'abeille", 'Déposer, aspirer, gratter les résidus collés, dégraisser.', 'Aspirateur + brosse laiton', 'Alvéoles dégagées, pas de résidus fondus', 'Hebdo', '15 min'],
      ['7', 'Tiroir à déchets', 'Vider intégralement, aspirer le fond du bâti.', 'Aspirateur', 'Tiroir vide et sec', 'Hebdo', '5 min'],
      ['8', "Buse d'assistance d'air", 'Dévisser, déboucher, contrôler le débit. Purger le condensat du compresseur.', 'Soufflette + aiguille laiton', "Flux d'air franc et centré", 'Hebdo', '5 min'],
      ['9', 'Extraction / filtres', "Contrôler la dépression, l'encrassement du préfiltre et la saturation du charbon actif. Noter le % restant.", 'Visuel + indicateur machine', "Aspiration franche, pas d'odeur en cabine", 'Hebdo', '10 min'],
      ['10', 'Ventilateurs et grilles', "Dépoussiérer toutes les entrées d'air et les ventilateurs d'électronique.", 'Aspirateur + pinceau', 'Grilles dégagées', 'Hebdo', '5 min'],
      ['11', 'Capot et vitre', "Nettoyer l'intérieur du capot et la vitre de protection.", 'Produit vitre non ammoniaqué', 'Visibilité parfaite', 'Hebdo', '5 min'],
      ['12', 'Capteurs / fins de course', "Dépoussiérer, vérifier la prise d'origine machine.", 'Soufflette', 'Origine machine correcte', 'Hebdo', '5 min'],
      ['13', "Arrêt d'urgence", "Actionner le bouton, vérifier l'arrêt immédiat, réarmer.", 'Test fonctionnel', 'Arrêt instantané — À CONSIGNER', 'Hebdo', '2 min'],
      ['14', 'Sécurité de capot', 'Ouvrir le capot en cours de cycle : le faisceau doit se couper.', 'Test fonctionnel', 'Coupure immédiate — À CONSIGNER', 'Hebdo', '2 min'],
      ['15', 'Test de coupe de référence', 'Lancer le fichier test sur chute. Comparer au gabarit de référence.', 'Fichier test + chute matière', 'Coupe nette, pas de perte de puissance', 'Hebdo', '10 min'],
      ['M1', 'Miroir de renvoi arrière + soufflet', 'Contrôle approfondi, dépose et nettoyage complet.', 'Kit optique', 'Alignement conservé', 'Mensuel', '20 min'],
      ['M2', 'Alignement faisceau', 'Test papier thermique aux 4 coins de la table.', 'Papier thermique', 'Impact identique aux 4 coins', 'Mensuel', '20 min'],
      ['M3', 'Remplacement filtre extraction', 'Selon indicateur de saturation. Consigner la date.', "Filtre d'origine", 'Indicateur remis à zéro', 'Selon usure', '15 min'],
      ['A1', 'Contrôle constructeur', 'Intervention SAV : puissance tube, alignement, sécurité.', 'Contrat SAV', 'Rapport SAV archivé', 'Annuel', '—'],
    ].map(([n, poste, faire, produit, controle, freq, duree]) =>
      ({ n, poste, faire, produit, controle, freq, duree })),
  },

  /* ---------------------------------------------- DTF — CONSOMMABLES ---- */
  dtf_consommables: {
    id: 'dtf_consommables',
    machine: 'Sublistar DTF',
    title: "Consommables & pièces d'usure",
    subtitle: 'Têtes EPSON I3200-A1 (2H8C). Une ligne par pièce. Mettre à jour la date à CHAQUE changement — le statut se recalcule seul.',
    rowLabel: 'pièce',
    addRow: () => ({ piece: '', qte: '1' }),
    flag: (r) => CALC.statut(r).tone === 'bad' || CALC.alerte(r).tone === 'bad',
    columns: [
      { key: 'piece',       label: 'Consommable / pièce', type: 'text', w: 230, stick: true, group: 'Identification' },
      { key: 'emplacement', label: 'Emplacement',         type: 'text', w: 165, group: 'Identification' },
      { key: 'ref',         label: 'Référence pièce',     type: 'text', w: 140, mono: true, group: 'Identification' },
      { key: 'qte',         label: 'Qté',                 type: 'num',  w: 62,  group: 'Identification' },
      { key: 'dernier',     label: 'Dernier remplacement',type: 'date', w: 150, group: 'Cycle de vie' },
      { key: 'dureeMois',   label: 'Vie (mois)',          type: 'num',  w: 84,  group: 'Cycle de vie' },
      { key: '_ech',        label: 'Prochaine échéance',  type: 'calc', calc: CALC.echeance, w: 142, group: 'Cycle de vie' },
      { key: '_statut',     label: 'Statut',              type: 'calc', calc: CALC.statut, w: 130, group: 'Cycle de vie' },
      { key: 'compteur',    label: 'Compteur (m) à la pose', type: 'num', w: 120, group: 'Cycle de vie' },
      { key: 'fournisseur', label: 'Fournisseur',         type: 'text', w: 130, group: 'Achat & traçabilité' },
      { key: 'commande',    label: 'N° commande / facture', type: 'text', w: 160, mono: true, group: 'Achat & traçabilité' },
      { key: 'cout',        label: 'Coût unit. (€)',      type: 'num',  w: 104, group: 'Achat & traçabilité' },
      { key: 'lot',         label: 'N° lot / série',      type: 'text', w: 130, mono: true, group: 'Achat & traçabilité' },
      { key: 'intervenant', label: 'Intervenant',         type: 'text', w: 120, group: 'Achat & traçabilité' },
      { key: 'stock',       label: 'Stock',               type: 'num',  w: 72,  group: 'Stock' },
      { key: 'seuil',       label: 'Seuil',               type: 'num',  w: 72,  group: 'Stock' },
      { key: '_alerte',     label: 'Alerte',              type: 'calc', calc: CALC.alerte, w: 118, group: 'Stock' },
      { key: 'obs',         label: 'Observations / motif',type: 'long', w: 320, group: 'Stock' },
    ],
    seed: () => [
      ['Damper blanc (x4)', 'Chariot — circuit blanc', 'DMP-I3200-W', '4', 6, 4],
      ['Damper couleur (x4)', 'Chariot — circuit CMYK', 'DMP-I3200-C', '4', 8, 4],
      ['Tête I3200-A1 — Blanc n°1', 'Chariot position 1', 'I3200-A1', '1', 12, 1],
      ['Tête I3200-A1 — Blanc n°2', 'Chariot position 2', 'I3200-A1', '1', 12, 1],
      ['Tête I3200-A1 — Couleur n°1', 'Chariot position 3', 'I3200-A1', '1', 12, 1],
      ['Tête I3200-A1 — Couleur n°2', 'Chariot position 4', 'I3200-A1', '1', 12, 1],
      ["Filtre d'encre en ligne — Blanc", 'Circuit blanc', 'FLT-INK-W', '2', 6, 2],
      ["Filtre d'encre en ligne — Couleur", 'Circuit CMYK', 'FLT-INK-C', '2', 6, 2],
      ["Station d'obturation (capping)", 'Station de parking', 'CAP-2H', '2', 6, 1],
      ["Racle d'essuyage (wiper)", 'Station de parking', 'WIP-2H', '2', 3, 4],
      ["Pompe d'aspiration / purge", 'Bloc pompe', 'PMP-SUC', '1', 12, 1],
      ['Agitateur encre blanche', 'Réservoir blanc', 'STIR-W', '1', 18, 0],
      ["Durites / tuyaux d'encre", 'Circuit complet', 'TUB-INK', '1', 12, 1],
      ['Filtre de dépression (air)', 'Pompe à vide', 'FLT-VAC', '1', 6, 2],
      ['Courroie chariot X', 'Axe X', 'BLT-X', '1', 24, 1],
      ['Roulements / patins chariot', 'Rail chariot', 'BRG-CAR', '4', 24, 0],
      ['Bande encodeur + capteur', 'Axe X', 'ENC-STRIP', '1', 24, 1],
      ['Courroie entraînement média', 'Axe Y', 'BLT-Y', '1', 24, 0],
      ['Rouleaux presseurs', 'Entrée média', 'ROL-PIN', '6', 24, 0],
      ['Tapis convoyeur du four', 'Four / shaker', 'BLT-OVEN', '1', 24, 0],
      ['Résistances chauffantes', 'Four', 'HTR-OVEN', '4', 24, 1],
      ['Moteur vibreur (shaker)', 'Shaker poudre', 'MOT-SHK', '1', 36, 0],
      ['Brosse / racleur de poudre', 'Shaker poudre', 'BRS-PWD', '1', 12, 1],
      ["Filtre d'aspiration poudre", 'Shaker poudre', 'FLT-PWD', '1', 3, 3],
      ['Filtre charbon actif — fumées', 'Extraction four', 'FLT-CARB', '1', 6, 2],
      ["Ventilateur d'extraction", 'Extraction four', 'FAN-EXT', '1', 36, 0],
      ['Bac à encre usagée', 'Sous station', 'WST-TANK', '1', 3, 1],
      ['Filtre / purge compresseur', 'Compresseur air', 'FLT-AIR', '1', 6, 2],
      ['Nappes de têtes (flat cables)', 'Chariot', 'FFC-I3200', '4', 24, 2],
      ['Encre Blanche', 'Réservoir', 'INK-W-5L', '1', 0, 2],
      ['Encre Cyan', 'Réservoir', 'INK-C-5L', '1', 0, 1],
      ['Encre Magenta', 'Réservoir', 'INK-M-5L', '1', 0, 1],
      ['Encre Jaune', 'Réservoir', 'INK-Y-5L', '1', 0, 1],
      ['Encre Noire', 'Réservoir', 'INK-K-5L', '1', 0, 1],
      ['Poudre hot-melt', 'Bac shaker', 'PWD-HM-20', '1', 0, 3],
      ['Film DTF (rouleau)', 'Dérouleur', 'FLM-60-100', '1', 0, 5],
      ['Liquide de nettoyage têtes', 'Atelier', 'CLN-1L', '1', 0, 2],
    ].map(([piece, emplacement, ref, qte, mois, seuil]) => ({
      piece, emplacement, ref, qte,
      dureeMois: mois ? String(mois) : '',
      seuil: String(seuil),
      dernier: '', compteur: '', fournisseur: '', commande: '',
      cout: '', lot: '', intervenant: '', stock: '', obs: '',
    })),
  },

  /* ------------------------------------------------ DTF — HISTORIQUE ---- */
  dtf_historique: {
    id: 'dtf_historique',
    machine: 'Sublistar DTF',
    title: 'Historique des remplacements',
    subtitle: "Journal permanent : on ajoute une ligne, on n'efface jamais une ligne existante.",
    rowLabel: 'remplacement',
    prepend: true,
    addRow: () => ({ date: today(), machine: 'DTF', motif: 'Préventif', testOK: '' }),
    columns: [
      { key: 'date',        label: 'Date',        type: 'date', w: 138, stick: true },
      { key: 'machine',     label: 'Machine',     type: 'select', options: ['DTF', 'Trotec'], w: 108, stick: true },
      { key: 'piece',       label: 'Consommable / pièce', type: 'text', w: 230 },
      { key: 'ref',         label: 'Réf.',        type: 'text', w: 130, mono: true },
      { key: 'qte',         label: 'Qté',         type: 'num',  w: 62 },
      { key: 'motif',       label: 'Motif',       type: 'select', options: ['Préventif', 'Usure normale', 'Casse', 'Panne', 'Amélioration', 'Garantie'], w: 138 },
      { key: 'compteur',    label: 'Compteur (m)',type: 'num',  w: 108 },
      { key: 'cout',        label: 'Coût total (€)', type: 'num', w: 112 },
      { key: 'fournisseur', label: 'Fournisseur', type: 'text', w: 130 },
      { key: 'commande',    label: 'N° commande', type: 'text', w: 150, mono: true },
      { key: 'intervenant', label: 'Intervenant', type: 'text', w: 126 },
      { key: 'arret',       label: 'Arrêt prod. (h)', type: 'num', w: 110 },
      { key: 'testOK',      label: 'Test qualité OK', type: 'select', options: ['OUI', 'NON'], w: 122 },
      { key: 'obs',         label: 'Observations', type: 'long', w: 340 },
    ],
    seed: () => [{
      date: '2025-07-01', machine: 'DTF', piece: 'Damper blanc (x4)', ref: 'DMP-I3200-W',
      qte: '4', motif: 'Préventif', compteur: '4820', cout: '50', fournisseur: 'Sublistar',
      commande: 'SUB-2025-0714', intervenant: 'Charlie', arret: '2.5', testOK: 'OUI',
      obs: 'EXEMPLE — encrassement circuit blanc, test buses conforme après purge',
    }],
  },

  /* ------------------------------------------------- JOURNAL PANNES ----- */
  pannes: {
    id: 'pannes',
    machine: 'Atelier',
    title: 'Journal des pannes',
    subtitle: 'Les deux machines. Toute case NOK du pointage hebdo doit générer une ligne ici.',
    rowLabel: 'anomalie',
    prepend: true,
    addRow: () => ({ datetime: nowLocal(), machine: 'Trotec', statut: 'Ouvert' }),
    flag: (r) => r.statut === 'Ouvert' || r.statut === 'En cours',
    columns: [
      { key: 'datetime',    label: 'Date / heure', type: 'datetime', w: 178, stick: true },
      { key: 'machine',     label: 'Machine',      type: 'select', options: ['Trotec', 'DTF', 'Atelier'], w: 108, stick: true },
      { key: 'description', label: "Description de l'anomalie", type: 'long', w: 320 },
      { key: 'cause',       label: 'Cause identifiée', type: 'long', w: 260 },
      { key: 'action',      label: 'Action corrective', type: 'long', w: 300 },
      { key: 'pieces',      label: 'Pièces utilisées', type: 'text', w: 200 },
      { key: 'arret',       label: 'Arrêt prod. (h)', type: 'num', w: 110 },
      { key: 'cout',        label: 'Coût (€)',     type: 'num', w: 96 },
      { key: 'statut',      label: 'Statut',       type: 'select', options: ['Ouvert', 'En cours', 'Résolu', 'Clôturé'], w: 122 },
      { key: 'traitePar',   label: 'Traité par',   type: 'text', w: 126 },
      { key: 'cloture',     label: 'Date de clôture', type: 'date', w: 140 },
    ],
    seed: () => [],
  },

  /* --------------------------------------------- MACHINES & GARANTIES --- */
  machines: {
    id: 'machines',
    machine: 'Atelier',
    title: 'Machines & garanties',
    subtitle: "À vérifier une fois par an. Ne jamais ouvrir une machine sous garantie sans accord écrit du SAV.",
    rowLabel: 'rubrique',
    addRow: () => ({ rubrique: '' }),
    columns: [
      { key: 'rubrique',  label: 'Rubrique',       type: 'text', w: 210, stick: true },
      { key: 'trotec',    label: 'Trotec (laser)', type: 'long', w: 300 },
      { key: 'sublistar', label: 'Sublistar DTF',  type: 'long', w: 300 },
      { key: 'remarque',  label: 'Remarque',       type: 'long', w: 320 },
    ],
    seed: () => [
      ['Modèle exact', '', '', 'Plaque constructeur'],
      ['N° de série', '', '', 'Demandé à chaque appel SAV'],
      ['Année de fabrication', '', '', ''],
      ["Date d'achat / facture", '', '', 'Point de départ de la garantie'],
      ['Fin de garantie', '', '', 'À surveiller'],
      ['Contrat de maintenance', '', '', 'N° de contrat + périmètre couvert'],
      ['Contact SAV — société', '', 'Sublistar', ''],
      ['Contact SAV — téléphone', '', '', ''],
      ['Contact SAV — e-mail', '', '', ''],
      ['N° client', '', '', ''],
      ['Fournisseur consommables', '', '', 'Prévoir un 2e fournisseur de secours'],
      ['Délai de livraison pièces', '', '', 'Conditionne le stock mini à garder'],
      ['Logiciel de pilotage', 'JobControl', 'Print Manager (BYHX)', ''],
      ['Version logiciel', '', '', 'À noter avant toute mise à jour'],
      ['RIP', '', 'FlexiPrint', ''],
    ].map(([rubrique, trotec, sublistar, remarque]) => ({ rubrique, trotec, sublistar, remarque })),
  },
};

/* --- navigation ---------------------------------------------------------- */

const NAV = [
  { label: null, items: [{ id: 'dashboard', label: 'Tableau de bord' }] },
  {
    label: 'Trotec — laser',
    items: [
      { id: 'trotec_hebdo', label: 'Pointage hebdo' },
      { id: 'trotec_procedure', label: 'Procédure nettoyage' },
    ],
  },
  {
    label: 'Sublistar DTF',
    items: [
      { id: 'dtf_consommables', label: 'Consommables & pièces' },
      { id: 'dtf_historique', label: 'Historique remplacements' },
    ],
  },
  {
    label: 'Atelier',
    items: [
      { id: 'pannes', label: 'Journal des pannes' },
      { id: 'machines', label: 'Machines & garanties' },
      { id: 'aide', label: 'Aide & rappels' },
    ],
  },
];

/* --- points de vigilance (repris de l'onglet « Lisez-moi ») -------------- */

const VIGILANCE = [
  "Le NOM de la personne qui a fait l'intervention (pas « atelier »).",
  'Le n° de lot / série de la pièce posée — seul élément qui permet une prise en garantie.',
  "Le n° de facture ou de commande du consommable — prouve l'origine et la date d'achat.",
  'Le compteur machine (mètres imprimés / heures laser) au moment du changement.',
  'Le motif du remplacement : usure normale, casse, préventif. Change tout en garantie.',
  "Le temps d'arrêt production en heures — c'est le chiffre que la direction regarde.",
  'Le coût de la pièce — permet de calculer le coût de maintenance au mètre imprimé.',
  "Le stock restant + le seuil d'alerte, pour ne jamais être à l'arrêt faute de pièce.",
  "Les contrôles sécurité (arrêt d'urgence, capot, extraction) : obligation légale, contrôlée.",
  'Un test qualité après intervention (test de coupe / test buses) daté et validé.',
  "La date de fin de garantie et le n° de contrat SAV, avant d'ouvrir une machine soi-même.",
  "La signature du technicien : sans elle, la feuille n'a aucune valeur de preuve.",
];
