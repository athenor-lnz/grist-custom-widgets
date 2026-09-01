# Format du modèle XLSX

Le format est volontairement simple et stable pour être rempli manuellement ou par une IA.

## TABLES
En-têtes obligatoires : `ID`, `LABEL`, `DESCRIPTION`.

## COLUMNS
En-têtes obligatoires : `TABLE`, `ID`, `LABEL`, `TYPE`, `FORMULA`, `DESCRIPTION`.

`FORMULA` contient une formule **Grist**, jamais une formule Excel.

## CHOICES
En-têtes : `TABLE`, `COLUMN`, `VALUE`. Une ligne par valeur.

## Règles d'identifiants
Les identifiants suivent `[A-Za-z][A-Za-z0-9_]*`. Les colonnes `id` et `manualSort` sont réservées.

## Références
- `Ref:UNITES`
- `RefList:UNITES`

La table cible doit être déclarée dans `TABLES`.
