# Maintenance Atelier — Trotec &amp; Sublistar DTF

Application web de suivi de maintenance pour l'atelier impression &amp; découpe.
Reprend intégralement le classeur `Maintenance_Trotec_DTF_1.xlsx` et le transforme
en outil de saisie : barre latérale par machine, tableaux remplissables, statuts
calculés automatiquement.

## Ce qu'il y a dedans

| Écran | Rôle |
|---|---|
| **Tableau de bord** | Pièces en retard, à commander, pannes ouvertes, arrêt production et coût cumulés. |
| **Trotec — Pointage hebdo** | 52 semaines pré-générées, 15 postes de contrôle en OK / NOK / N-A, conformité calculée. |
| **Trotec — Procédure** | Le détail de chaque poste : geste, produit, point de contrôle, fréquence, durée. |
| **DTF — Consommables** | 37 pièces d'usure. Échéance = dernière pose + durée de vie ; statut et alerte stock automatiques. |
| **DTF — Historique** | Journal permanent des remplacements. On ajoute, on n'efface pas. |
| **Journal des pannes** | Anomalies des deux machines, cause, action corrective, arrêt production, clôture. |
| **Machines &amp; garanties** | N° de série, fin de garantie, contacts SAV, versions logicielles. |
| **Aide &amp; rappels** | Les 12 points qui protègent en cas de litige + mode d'emploi. |

## Utilisation

- **Saisie directe dans le tableau.** Enregistrement automatique, sans bouton « Valider ».
- **Cases OK/NOK** : un clic fait défiler `OK → NOK → N-A → vide`. Au clavier : `O`, `N`, `A`.
- **Clavier** : `Entrée` / `↓` descend d'une ligne, `↑` remonte, `Tab` passe à la colonne suivante.
- **Bouton numéroté** en début de ligne : ouvre la ligne entière en plein écran (pratique sur tablette)
  et permet de la supprimer.
- **Colonnes calculées** (échéance, statut, conformité, alerte stock) : jamais à taper.
- **CSV** sur chaque tableau : s'ouvre directement dans Excel (séparateur `;`, UTF-8 BOM).
- **Imprimer** : sort le tableau en A4 paysage sans l'interface, pour signature papier.

## Données

Tout est stocké dans le **navigateur du poste** (`localStorage`) — aucun serveur, aucune
donnée envoyée sur Internet. Conséquences pratiques :

- Les données ne suivent pas d'un poste à l'autre ni d'un navigateur à l'autre.
- Vider les données du navigateur efface la saisie.
- **Faire une `Sauvegarde .json` une fois par mois** (bouton en bas de la barre latérale)
  sur le réseau ou une clé USB. `Restaurer` relit ce fichier.

## Développement

Aucune dépendance, aucune étape de build. Cinq fichiers :

```
index.html
assets/css/app.css
assets/js/schema.js   colonnes, données d'amorçage, formules de calcul
assets/js/store.js    persistance, sauvegarde/restauration, export CSV
assets/js/app.js      routage, rendu des tables, fiche de ligne, tableau de bord
```

Servir en local :

```bash
python3 -m http.server 4173
```

**Ajouter une colonne, un poste de contrôle ou une machine** : tout se passe dans
`assets/js/schema.js`. Le rendu, la fiche de ligne, l'export CSV et l'impression
suivent automatiquement. Les données déjà saisies ne sont pas perdues : au
chargement, le store repart du schéma courant et conserve les lignes existantes.

Types de colonnes disponibles : `text`, `long`, `num`, `date`, `datetime`,
`select` (+ `options`), `tri` (OK/NOK/N-A), `calc` (+ `calc(row)` renvoyant
`{ text, tone }` avec `tone` parmi `ok` / `warn` / `bad` / `mute`).

## Cibles

iPhone (390–430 px), tablette Android 11" (800 × 1280 et 1280 × 800), desktop jusqu'à
l'ultra-wide. Cibles tactiles ≥ 44 px, champs à 16 px sur mobile (pas de zoom iOS),
safe-areas respectées.

## Source

`source/Maintenance_Trotec_DTF_1.xlsx` — le classeur d'origine, conservé comme référence.
