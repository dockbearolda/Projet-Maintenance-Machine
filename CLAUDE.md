TABLETTE: oui

# Projet — Maintenance Atelier (Trotec / Sublistar DTF)

Suivi de maintenance. **Aucune dépendance, aucun build.** HTML + CSS + JS vanilla au
navigateur, et un `server.js` en bibliothèque standard de Node qui sert ces fichiers
et partage les lignes entre les postes.

Publié depuis `main` sur Railway (projet `maintenance-atelier`, service `maintenance`,
volume monté sur `/data`, variable `CODE_ATELIER`) et sur GitHub Pages en secours.
`Dockerfile` et `railway.json` ne servent qu'à l'hébergement : ils n'ajoutent rien au
navigateur.

## Contraintes du projet

- **Zéro dépendance.** Pas de framework, pas de bundler, pas de npm — ni au navigateur
  ni au serveur. Si une fonctionnalité demande une lib, chercher d'abord la solution en
  API navigateur native ou en bibliothèque standard de Node.
- **Le site doit rester servable en fichiers bruts.** Sans `server.js`, la sonde d'accueil
  de `sync.js` échoue, le partage se met en veille et l'appli redevient celle d'avant,
  chaque poste avec son `localStorage`. C'est ce qui fait tenir le secours GitHub Pages :
  ne jamais rendre le rendu dépendant d'une réponse du serveur.
- **Le navigateur écrit d'abord chez lui.** `localStorage` reste la source d'affichage ;
  l'envoi au serveur vient après, par une file persistée que rien ne doit court-circuiter.
  Réseau coupé, la saisie continue. Une écriture qui attendrait une réponse serveur pour
  s'afficher est un bug.
- **Une ligne se désigne par son `_id`, jamais par son rang.** Deux postes n'ont aucune
  raison de compter pareil, et l'ajout d'un collègue décale les indices sans prévenir.
  Aucune API du store ne prend d'indice.
- **Le serveur ignore le schéma.** Il range des lignes dans des tables nommées, sans
  savoir ce qu'est une colonne. Ajouter une machine ne doit jamais demander d'y toucher.
- **Le schéma est la source de vérité.** Ajouter une colonne, un tableau ou une machine
  se fait uniquement dans `assets/js/schema.js`. Si une évolution oblige à toucher au rendu
  dans `app.js`, c'est probablement que le type de colonne manque — l'ajouter au moteur
  plutôt que de faire un cas particulier.
- **Compatibilité des données.** `Store.load()` repart toujours du schéma courant et
  conserve les lignes déjà saisies. Ne jamais casser ça : les données de l'atelier ne sont
  pas régénérables. Côté serveur, un fichier illisible est mis de côté, jamais écrasé.
- **Rien ne s'efface.** `data.journal` est en ajout seul, et retirer une ligne la met dans
  `data.trash` — il n'existe aucune suppression définitive. Ne pas introduire de chemin qui
  en crée une, ni qui réécrit une entrée de journal. Seule exception, assumée : la
  coalescence de `noteModif()`, qui prolonge la dernière entrée tant qu'on tape dans le
  même champ de la même ligne — `prolonge()` fait exactement pareil côté serveur, les deux
  doivent rester d'accord. `restore()` remplace les tableaux mais **fusionne** journal et
  corbeille : l'historique ne recule jamais, et `applyRemote()` suit la même règle.
- **Un échec d'écriture se voit.** `persist()` remonte l'erreur par un état `error`, et
  `renderAlertes()` en fait un bandeau qui reste. Le serveur refuse franchement quand il
  n'arrive pas à écrire, et `sync.js` affiche « Hors ligne » avec le nombre d'écritures en
  attente. Ne jamais retomber sur un `catch` muet : croire que c'est enregistré est pire
  que de savoir que ça ne l'est pas.
- **Panne ≠ absence.** Un 404 ou une page HTML dit qu'il n'y a pas d'API à cette adresse :
  on repasse en mode poste. Un réseau coupé ne dit rien — un navigateur déjà relié doit
  attendre et réessayer, jamais basculer en local, sinon une panne d'une minute fait
  travailler l'atelier une journée sur des données qui ne remonteront pas.
- **La frappe en cours est intouchable.** `Store.protege()` désigne le champ sous le
  curseur ; l'état venu du serveur ne l'écrase pas, et le repeint remet curseur et
  sélection en place. Un opérateur ne doit jamais voir sa saisie s'effacer sous ses doigts.
- **Un seul point d'injection HTML** : la fonction `paint()` dans `app.js`. Toute valeur
  saisie passe par `esc()` avant d'y arriver. Ne pas introduire d'autre chemin.

## Usage réel

Tablette Android 11" en atelier (1280 × 800 paysage principalement), et PC de bureau.
Les deux orientations doivent être testées. L'opérateur a les mains sales et des gants :
cibles ≥ 44 px, pas d'action qui dépend du survol, pas de double-clic.

## Vérification avant de livrer

- `node --check` sur `server.js` et les quatre fichiers de `assets/js`.
- `node test/serveur.mjs` : le serveur est lancé pour de vrai, tout doit passer.
- Rendu à 390 px, 800 × 1280, 1280 × 800 et 1440 px.
- Aller-retour sauvegarde `.json` → restauration : les tableaux reviennent à l'état du
  fichier, le journal et la corbeille gardent aussi ce qui s'est passé depuis.
- Export CSV (tableaux **et** historique) : séparateur `;` et BOM UTF-8 (Excel FR).
- Une ligne mise à la corbeille se retrouve dans l'écran Corbeille et se remet en place.
- Écriture en échec (`localStorage.setItem` qui jette) : bandeau rouge + « Non enregistré ».

Partage — chaque point est un défaut déjà rencontré, pas une précaution théorique :

- Une ligne ajoutée d'un côté apparaît de l'autre, et une ligne retirée disparaît des deux.
- Serveur arrêté en pleine saisie : témoin « Hors ligne » avec le bon compteur, la saisie
  continue ; serveur relancé, tout rattrape sans intervention.
- Serveur déjà éteint au chargement d'un poste déjà relié : « Hors ligne », pas « Ce poste ».
- Adresse sans API (404 ou page HTML) : « Ce poste », et la file d'envoi ne se remplit pas.
- Modification distante pendant qu'on tape dans une autre case : le texte et le curseur
  ne bougent pas.
- Mauvais code refusé et non mémorisé ; bon code accepté, les écritures en attente partent.
- Redémarrage du serveur : ni ligne ni entrée de journal perdue, `seq` inchangé.
