# Grist Data Loader

Widget Grist autonome pour importer, simuler, sauvegarder et appliquer des données de référence dans le document courant.

## Rôle

- Grist Model Builder : structure du document
- Grist Data Loader : données de référence
- Grist ACL Studio : droits d'accès

## Fonctions v0.1.0

- import JSON par fichier ou copier-coller
- modes `create`, `update` et `upsert`
- clé métier configurable par table
- simulation avant écriture
- comparaison créer / modifier / inchangé / ignoré
- résolution des colonnes `Ref:` et `RefList:`
- références possibles vers des lignes créées dans le même import
- ordre automatique selon les dépendances entre tables
- sauvegarde JSON avant application
- aucun backend, aucune clé API, document courant uniquement

## URL

`https://athenor-lnz.github.io/grist-custom-widgets/grist-data-loader/`

## Version

0.1.0
