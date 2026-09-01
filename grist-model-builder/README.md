# Grist Model Builder

Widget Grist autonome pour **concevoir, simuler, construire et exporter le schéma du document courant**.

## Deux parcours guidés

### Débutant — XLSX
1. Télécharger le modèle XLSX.
2. Copier le prompt IA dédié.
3. Faire compléter le classeur par une IA ou manuellement.
4. Importer le XLSX.
5. Valider, simuler puis construire.

### Expert — JSON
1. Copier le prompt JSON.
2. Faire générer ou rédiger le JSON.
3. Coller le JSON ou charger un fichier `.json`.
4. Valider, simuler puis construire.

Les deux formats sont convertis vers le même modèle interne.

## Fonctionnalités

- tables, colonnes et types Grist ;
- `Ref:` et `RefList:` ;
- `DISPLAY` pour choisir la colonne affichée d'une référence ;
- `Choice` et `ChoiceList` ;
- formules Grist ;
- paramètres de date/fuseau ;
- simulation avant écriture ;
- création non destructive : aucune suppression et aucune modification automatique d'une colonne existante différente ;
- export du schéma Grist courant en XLSX ou JSON.

## Paramètres français par défaut

- `timezone`: `Europe/Paris`
- `dateFormat`: `DD/MM/YYYY`
- `timeFormat`: `HH:mm`

Un type `DateTime` sans fuseau explicite devient `DateTime:Europe/Paris`. Un type explicite comme `DateTime:UTC` reste inchangé.

## Format XLSX

Feuilles :
- `TABLES`
- `COLUMNS`
- `CHOICES`
- `SETTINGS`
- `LIRE_MOI`
- `INSTRUCTIONS_IA`

`COLUMNS` contient :
`TABLE | ID | LABEL | TYPE | DISPLAY | FORMULA | DESCRIPTION`

`DISPLAY` est facultatif et réservé aux colonnes `Ref:` / `RefList:`. Il contient l'identifiant de la colonne à afficher dans la table cible.

## Format JSON

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

Un exemple complet est fourni dans `templates/exemple-modele-grist.json`.

## API Grist

Le widget ne dépend pas de la ligne sélectionnée et n'utilise donc pas `onRecord` / `onRecords`.
Il agit sur le schéma complet du document via :
- `grist.ready({requiredAccess: 'full'})`
- `grist.docApi.listTables()`
- `grist.docApi.fetchTable()`
- `grist.docApi.applyUserActions()`

Aucune clé API Grist, aucun backend et aucun accès multi-documents.

## URL

`https://athenor-lnz.github.io/grist-custom-widgets/grist-model-builder/`

## Sécurité

Le XLSX/JSON est analysé dans le navigateur. Son contenu n'est pas envoyé à un serveur applicatif par Grist Model Builder.

## Licence

MIT.
