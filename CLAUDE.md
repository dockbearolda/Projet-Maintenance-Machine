TABLETTE: oui

# Projet — Maintenance Atelier (Trotec / Sublistar DTF)

Site statique de suivi de maintenance. **Aucune dépendance, aucun build, aucun serveur.**
HTML + CSS + JS vanilla servis tels quels par GitHub Pages.

## Contraintes du projet

- **Zéro dépendance.** Pas de framework, pas de bundler, pas de npm. Si une fonctionnalité
  demande une lib, chercher d'abord la solution en API navigateur native.
- **Données locales.** Tout vit dans `localStorage` du poste. Aucun appel réseau, aucun
  compte, aucune donnée qui sort. Toute évolution vers une base partagée est un choix
  d'archi structurant → à valider avant.
- **Le schéma est la source de vérité.** Ajouter une colonne / un poste / une machine se
  fait uniquement dans `assets/js/schema.js`. Si une évolution oblige à toucher au rendu
  dans `app.js`, c'est probablement que le type de colonne manque — l'ajouter au moteur
  plutôt que de faire un cas particulier.
- **Compatibilité des données.** `Store.load()` repart toujours du schéma courant et
  conserve les lignes déjà saisies. Ne jamais casser ça : les données de l'atelier ne sont
  pas régénérables.
- **Un seul point d'injection HTML** : la fonction `paint()` dans `app.js`. Toute valeur
  saisie passe par `esc()` avant d'y arriver. Ne pas introduire d'autre chemin.

## Usage réel

Tablette Android 11" en atelier (1280 × 800 paysage principalement), et PC de bureau.
Les deux orientations doivent être testées. L'opérateur a les mains sales et des gants :
cibles ≥ 44 px, pas d'action qui dépend du survol, pas de double-clic.

## Vérification avant de livrer

- `node --check` sur les trois fichiers JS.
- Rendu à 390 px, 800 × 1280, 1280 × 800 et 1440 px.
- Aller-retour sauvegarde `.json` → restauration.
- Export CSV : séparateur `;` et BOM UTF-8 (Excel FR).
