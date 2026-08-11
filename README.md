# Maintenance Atelier — Trotec, Sublistar DTF &amp; Roland UV

Trois tableaux à remplir, rien d'autre. Suivi de maintenance de l'atelier
impression &amp; découpe.

| Écran | Une ligne = | Colonnes |
|---|---|---|
| **Trotec — nettoyages** | un nettoyage complet | Date, Technicien, Remarques |
| **DTF — pièces** | une pièce changée | Date, Pièce, Qté, Coût, Technicien, Remarques |
| **Roland UV — pièces** | une pièce changée | Date, Pièce, Qté, Coût, Technicien, Remarques |

## Utilisation

- **`+ Ligne`** ajoute une ligne en tête, avec la date du jour déjà remplie, et
  pose le curseur sur la première case à saisir.
- **Saisie directe dans le tableau.** Enregistrement automatique, sans bouton
  « Valider ».
- **Clavier** : `Entrée` / `↓` descend d'une ligne, `↑` remonte, `Tab` passe à la
  colonne suivante.
- **Bouton numéroté** en début de ligne : ouvre la ligne entière en plein écran
  (pratique sur tablette) et permet de la supprimer.
- **Recherche** : filtre le tableau affiché, sur toutes les colonnes à la fois.
- **CSV** : s'ouvre directement dans Excel (séparateur `;`, UTF-8 BOM).
- **Imprimer** : sort le tableau en A4 portrait sans l'interface, pour signature
  papier.

## Données

Tout est stocké dans le **navigateur du poste** (`localStorage`) — aucun serveur,
aucune donnée envoyée sur Internet. Conséquences pratiques :

- Les données ne suivent pas d'un poste à l'autre ni d'un navigateur à l'autre.
- Vider les données du navigateur efface la saisie.
- **Faire une `Sauvegarde .json` une fois par mois** (bouton en bas de la barre
  latérale) sur le réseau ou une clé USB. `Restaurer` relit ce fichier.

Une table retirée du schéma n'est pas effacée pour autant : ses lignes restent
dans le stockage et dans la sauvegarde. Rien de ce qui a été saisi ne disparaît.

## Mise en ligne

Le site est publié aux deux adresses, à partir de la même branche `main` :

| Hébergeur | URL |
|---|---|
| Railway (principal) | https://maintenance-production-3cee.up.railway.app |
| GitHub Pages (secours) | https://dockbearolda.github.io/Projet-Maintenance-Machine/ |

Un `git push` sur `main` redéploie automatiquement les deux. Côté Railway, le
service `maintenance` du projet `maintenance-atelier` sert les fichiers derrière
Caddy (`Dockerfile` + `Caddyfile`) : aucune étape de build, on copie `index.html`
et `assets/` dans l'image. Tout est servi en `no-cache` : une correction arrive
sur le poste au prochain chargement, sans vidage de cache.

## Développement

Aucune dépendance, aucune étape de build. Cinq fichiers :

```
index.html
assets/css/app.css
assets/js/schema.js   les trois tableaux, leurs colonnes, la navigation
assets/js/store.js    persistance, sauvegarde/restauration, export CSV
assets/js/app.js      routage, rendu des tableaux, fiche de ligne
```

Infrastructure : `Dockerfile`, `Caddyfile`, `railway.json`. Ces trois fichiers ne
concernent que l'hébergement — ils n'ajoutent aucune dépendance au navigateur.

Servir en local :

```bash
python3 -m http.server 4173
```

**Ajouter une colonne, un tableau ou une machine** : tout se passe dans
`assets/js/schema.js`. Le rendu, la fiche de ligne, l'export CSV et l'impression
suivent automatiquement. Les données déjà saisies ne sont pas perdues : au
chargement, le store repart du schéma courant et conserve les lignes existantes.

Types de colonnes disponibles : `text`, `long`, `num`, `date`, `select`
(+ `options`). La largeur `w` d'une colonne sert aussi de proportion : sur
tablette en portrait, les colonnes sont ramenées à l'écran dans ces proportions
pour éviter le défilement latéral.

## Cibles

iPhone (390–430 px), tablette Android 11" (800 × 1280 et 1280 × 800), desktop
jusqu'à l'ultra-wide. Cibles tactiles ≥ 44 px — lignes du tableau comprises —
champs à 16 px sur mobile (pas de zoom iOS), safe-areas respectées.

## Source

`source/Maintenance_Trotec_DTF_1.xlsx` — le classeur d'origine, conservé comme
référence. La version détaillée du site (pointage hebdomadaire 22 colonnes,
procédure de nettoyage, consommables, journal des pannes, garanties) reste dans
l'historique git, avant le commit « Ramene le site a trois tableaux ».
