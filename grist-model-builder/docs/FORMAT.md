# Format du modèle — Grist Model Builder v1.1

Grist Model Builder accepte deux représentations équivalentes : **XLSX** et **JSON**. Elles alimentent le même moteur interne.

## Paramètres par défaut

- `timezone` : `Europe/Paris`
- `dateFormat` : `DD/MM/YYYY`
- `timeFormat` : `HH:mm`

Un type `DateTime` sans fuseau explicite est converti en `DateTime:Europe/Paris` par défaut. Un type explicite comme `DateTime:UTC` est conservé.

## XLSX

### SETTINGS
En-têtes : `KEY`, `VALUE`, `DESCRIPTION`.

Clés reconnues : `timezone`, `dateFormat`, `timeFormat`.

### TABLES
En-têtes : `ID`, `LABEL`, `DESCRIPTION`.

### COLUMNS
En-têtes : `TABLE`, `ID`, `LABEL`, `TYPE`, `DISPLAY`, `FORMULA`, `DESCRIPTION`.

`FORMULA` contient une formule **Grist**, jamais une formule Excel.

`DISPLAY` est facultatif. Il s'utilise uniquement sur une colonne `Ref:` ou `RefList:` et contient l'identifiant de la colonne de la table cible à afficher à l'utilisateur.

Exemple : `UTILISATEURS.UNITE` de type `Ref:UNITES` peut avoir `DISPLAY=NOM`.

### CHOICES
En-têtes : `TABLE`, `COLUMN`, `VALUE`. Une ligne par valeur.

## JSON

Objet racine :

```json
{
  "settings": {
    "timezone": "Europe/Paris",
    "dateFormat": "DD/MM/YYYY",
    "timeFormat": "HH:mm"
  },
  "tables": [],
  "columns": [],
  "choices": []
}
```

Une colonne JSON utilise les clés `table`, `id`, `label`, `type`, `display`, `formula`, `description`.

## Types pris en charge

- `Text`
- `Numeric`
- `Int`
- `Bool`
- `Date`
- `DateTime`
- `DateTime:Timezone`
- `Choice`
- `ChoiceList`
- `Attachments`
- `Any`
- `Ref:TABLE`
- `RefList:TABLE`

## Règles d'identifiants

Les identifiants suivent `[A-Za-z][A-Za-z0-9_]*`. Les colonnes `id` et `manualSort` sont réservées.

## Références

La table cible doit être déclarée. Si `DISPLAY` est renseigné, la colonne correspondante doit exister dans la table cible.
