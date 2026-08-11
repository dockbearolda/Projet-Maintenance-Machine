# Maintenance Atelier — Trotec, Sublistar DTF &amp; Roland UV

Trois tableaux à remplir, rien d'autre. Suivi de maintenance de l'atelier
impression &amp; découpe.

| Écran | Une ligne = | Colonnes |
|---|---|---|
| **Trotec — nettoyages** | un nettoyage complet | Date et heure, Technicien, Remarques |
| **DTF — pièces** | une pièce changée | Date et heure, Pièce, Qté, Technicien, Remarques |
| **Roland UV — pièces** | une pièce changée | Date et heure, Pièce, Qté, Technicien, Remarques |

Deux écrans de suivi s'ajoutent, en lecture seule : **Historique** et
**Corbeille**. Voir [Rien ne se perd](#rien-ne-se-perd).

### Nettoyage de la turbine (Trotec)

Entretien propre au laser, à faire **tous les 6 mois**. Un bandeau en tête du
tableau Trotec annonce la dernière fois qu'il a été fait et quand tombe le
prochain ; il passe en rouge dès que l'échéance est dépassée, ou tant que rien
n'a été consigné. Le bouton **Consigner le nettoyage** ajoute la ligne avec le
bon libellé dans **Remarques**, sans avoir à le taper — c'est cette colonne que
le bandeau relit pour dater le dernier passage.

## Utilisation

- **`+ Ligne`** ajoute une ligne en tête, avec la date **et l'heure** du moment
  déjà remplies, et pose le curseur sur la première case à saisir.
- **Saisie directe dans le tableau.** Enregistrement automatique, sans bouton
  « Valider ».
- **Clavier** : `Entrée` / `↓` descend d'une ligne, `↑` remonte, `Tab` passe à la
  colonne suivante.
- **Bouton numéroté** en début de ligne : ouvre la ligne entière en plein écran
  (pratique sur tablette) et permet de la mettre à la corbeille.
- **Poste** (bas de la barre latérale) : le nom de la machine — « Tablette
  atelier », « PC bureau ». Il signe chaque écriture dans l'historique et permet
  de savoir d'où vient une ligne quand on remonte une sauvegarde.
- **Recherche** : filtre le tableau affiché, sur toutes les colonnes à la fois.
- **CSV** : s'ouvre directement dans Excel (séparateur `;`, UTF-8 BOM).
- **Imprimer** : sort le tableau en A4 portrait sans l'interface, pour signature
  papier.

## Rien ne se perd

Ce que le site garantit, à l'intérieur d'un poste :

- **Historique.** Chaque écriture est consignée : quand, quel écran, quelle
  ligne, quel champ, la valeur **avant** et la valeur **après**, et le poste.
  Le journal est en ajout seul — aucune entrée ne se modifie ni ne s'efface. Les
  frappes successives dans un même champ sont regroupées en une entrée, sinon
  taper « turbine » en produirait sept. Export CSV comme les tableaux.
- **Corbeille.** Une ligne retirée d'un tableau ne disparaît pas : elle part à la
  corbeille, reste dans la sauvegarde `.json` et se remet en place d'un bouton.
  Il n'existe aucune suppression définitive dans l'interface.
- **Alerte d'écriture.** Si le navigateur refuse d'enregistrer (stockage plein ou
  bloqué), un bandeau rouge le dit et le voyant passe à « Non enregistré ». Plus
  d'échec silencieux : avant, la saisie continuait dans le vide.
- **Stockage protégé.** Au démarrage, le site demande au navigateur de ne pas
  vider ce stockage quand la place manque. L'état obtenu se lit en bas de la
  barre latérale.
- **Rappel de sauvegarde.** Un bandeau apparaît au bout de sept jours sans
  `Sauvegarde .json`, et tant qu'aucune n'a été faite.
- **Filet à la restauration.** `Restaurer` télécharge d'abord l'état courant,
  puis remplace les tableaux par le fichier. L'historique et la corbeille, eux,
  sont **fusionnés** : revenir en arrière sur les tableaux ne fait pas reculer
  l'historique, on voit toujours ce qui a existé entre-temps.
- Une table retirée du schéma n'est pas effacée : ses lignes restent dans le
  stockage et dans la sauvegarde.

## Données — ce qui n'est pas garanti

Tout est stocké dans le **navigateur du poste** (`localStorage`) — aucun serveur,
aucune donnée envoyée sur Internet. Conséquences pratiques, que rien de ce qui
précède ne corrige :

- **Les données ne suivent pas d'un poste à l'autre.** La tablette et le PC ont
  deux bases séparées qui ne se parlent jamais. Idem entre l'adresse Railway et
  celle de GitHub Pages : deux origines, deux stockages.
- **Vider les données du navigateur efface la saisie.** La demande de stockage
  protégé n'empêche pas un effacement volontaire par l'opérateur.
- **Un poste perdu, c'est les données du poste.** Seule la `Sauvegarde .json`
  sortie du navigateur protège de ça.

D'où la règle : **`Sauvegarde .json` une fois par semaine** (bouton en bas de la
barre latérale) sur le réseau ou une clé USB. Le fichier contient les tableaux,
l'historique et la corbeille. `Restaurer` le relit.

Un vrai suivi partagé entre la tablette et le PC demande une base commune, donc
un serveur : c'est un choix d'archi structurant, hors du périmètre actuel.

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
assets/js/schema.js   les tableaux, les écrans de suivi, la navigation
assets/js/store.js    persistance, journal, corbeille, sauvegarde, export CSV
assets/js/app.js      routage, rendu des tableaux et du suivi, fiche de ligne
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

Types de colonnes disponibles : `text`, `long`, `num`, `date`, `datetime`,
`select` (+ `options`). La largeur `w` d'une colonne sert aussi de proportion :
sur tablette en portrait, les colonnes sont ramenées à l'écran dans ces
proportions pour éviter le défilement latéral.

**Ajouter un entretien périodique** : donner à la table un objet `rappel`
(`titre`, `mois`, `cle`, `motCle`, `valeur`). Le bandeau et son bouton sont
rendus par le moteur — rien à écrire de plus, pour n'importe quelle table.

**Écrans de suivi** : déclarés dans `ECRANS` (même fichier), avec une clé `vue`
qui désigne le rendu correspondant dans `app.js`. Ils n'ont pas de `seed` : ils
lisent ce que le store a gardé, ils ne stockent rien eux-mêmes.

**Identité des lignes** : chaque ligne porte un `_id` posé à la création, et
récupéré à la volée pour les lignes d'avant l'historique. C'est lui qui relie une
ligne à ses entrées de journal — l'indice ne suffirait pas, les tableaux insèrent
en tête. Il ne s'affiche jamais et ne sort pas au CSV.

## Cibles

iPhone (390–430 px), tablette Android 11" (800 × 1280 et 1280 × 800), desktop
jusqu'à l'ultra-wide. Cibles tactiles ≥ 44 px — lignes du tableau comprises —
champs à 16 px sur mobile (pas de zoom iOS), safe-areas respectées.

## Source

`source/Maintenance_Trotec_DTF_1.xlsx` — le classeur d'origine, conservé comme
référence. La version détaillée du site (pointage hebdomadaire 22 colonnes,
procédure de nettoyage, consommables, journal des pannes, garanties) reste dans
l'historique git, avant le commit « Ramene le site a trois tableaux ».
