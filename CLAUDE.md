TABLETTE: oui

# Projet — Maintenance Atelier (Trotec / Sublistar DTF)

Site statique de suivi de maintenance. **Aucune dépendance, aucun build, aucun serveur
applicatif.** HTML + CSS + JS vanilla servis tels quels.

Publié depuis `main` sur Railway (projet `maintenance-atelier`, service `maintenance`,
derrière Caddy) et sur GitHub Pages en secours. `Dockerfile`, `Caddyfile` et
`railway.json` ne servent qu'à l'hébergement : ils n'ajoutent rien au navigateur, et
toute modification du site doit rester servable en fichiers statiques bruts.

## Contraintes du projet

- **Zéro dépendance.** Pas de framework, pas de bundler, pas de npm. Si une fonctionnalité
  demande une lib, chercher d'abord la solution en API navigateur native.
- **Données locales.** Tout vit dans `localStorage` du poste. Aucun appel réseau, aucun
  compte, aucune donnée qui sort. Toute évolution vers une base partagée est un choix
  d'archi structurant → à valider avant.
- **Le schéma est la source de vérité.** Ajouter une colonne, un tableau ou une machine
  se fait uniquement dans `assets/js/schema.js`. Si une évolution oblige à toucher au rendu
  dans `app.js`, c'est probablement que le type de colonne manque — l'ajouter au moteur
  plutôt que de faire un cas particulier.
- **Compatibilité des données.** `Store.load()` repart toujours du schéma courant et
  conserve les lignes déjà saisies. Ne jamais casser ça : les données de l'atelier ne sont
  pas régénérables.
- **Rien ne s'efface.** `data.journal` est en ajout seul, et retirer une ligne la met dans
  `data.trash` — il n'existe aucune suppression définitive. Ne pas introduire de chemin qui
  en crée une, ni qui réécrit une entrée de journal. Seule exception, assumée : la
  coalescence de `noteModif()`, qui prolonge la dernière entrée tant qu'on tape dans le
  même champ de la même ligne. `restore()` remplace les tableaux mais **fusionne** journal
  et corbeille : l'historique ne recule jamais.
- **Un échec d'écriture se voit.** `persist()` remonte l'erreur par un état `error`, et
  `renderAlertes()` en fait un bandeau qui reste. Ne jamais retomber sur un `catch` muet :
  croire que c'est enregistré est pire que de savoir que ça ne l'est pas.
- **Un seul point d'injection HTML** : la fonction `paint()` dans `app.js`. Toute valeur
  saisie passe par `esc()` avant d'y arriver. Ne pas introduire d'autre chemin.

## Usage réel

Tablette Android 11" en atelier (1280 × 800 paysage principalement), et PC de bureau.
Les deux orientations doivent être testées. L'opérateur a les mains sales et des gants :
cibles ≥ 44 px, pas d'action qui dépend du survol, pas de double-clic.

## Vérification avant de livrer

- `node --check` sur les trois fichiers JS.
- Rendu à 390 px, 800 × 1280, 1280 × 800 et 1440 px.
- Aller-retour sauvegarde `.json` → restauration : les tableaux reviennent à l'état du
  fichier, le journal et la corbeille gardent aussi ce qui s'est passé depuis.
- Export CSV (tableaux **et** historique) : séparateur `;` et BOM UTF-8 (Excel FR).
- Une ligne mise à la corbeille se retrouve dans l'écran Corbeille et se remet en place.
- Écriture en échec (`localStorage.setItem` qui jette) : bandeau rouge + « Non enregistré ».
