# Grist Model Builder

Widget Grist autonome permettant de construire les **tables et colonnes du document courant** à partir d'un modèle XLSX standardisé.

## Fonctionnement

- téléchargez le modèle XLSX ;
- complétez-le manuellement ou avec l'aide du prompt IA fourni ;
- importez le fichier dans le widget ;
- validez la structure ;
- simulez les changements ;
- créez uniquement les tables et colonnes manquantes.

Aucune clé API, aucun serveur et aucun accès multi-documents ne sont nécessaires. Le widget utilise l'API officielle des widgets Grist avec **Full document access**.

## Pourquoi pas `onRecord` / `onRecords` ?

Ce widget ne dépend pas de la ligne sélectionnée. Il agit sur le **schéma complet du document**. Il utilise donc `grist.ready({requiredAccess: 'full'})`, `grist.onOptions`, `grist.docApi.listTables`, `fetchTable` et `applyUserActions`.

## URL du widget

Une fois GitHub Pages activé sur ce dépôt :

`https://athenor-lnz.github.io/grist-custom-widgets/grist-model-builder/`

Dans Grist : **Ajouter un widget → Personnalisé → URL personnalisée** puis collez cette URL et autorisez l'accès complet au document.

## Format XLSX

### `TABLES`

| ID | LABEL | DESCRIPTION |
|---|---|---|
| UNITES | Unités | Référentiel des unités |

### `COLUMNS`

| TABLE | ID | LABEL | TYPE | FORMULA | DESCRIPTION |
|---|---|---|---|---|---|
| UNITES | NOM | Nom | Text | | |
| UTILISATEURS | UNITE | Unité | Ref:UNITES | | |

Types supportés : `Text`, `Numeric`, `Int`, `Bool`, `Date`, `DateTime`, `DateTime:Timezone`, `Choice`, `ChoiceList`, `Attachments`, `Any`, `Ref:TABLE`, `RefList:TABLE`.

### `CHOICES`

| TABLE | COLUMN | VALUE |
|---|---|---|
| UTILISATEURS | DROITS | Lecture |
| UTILISATEURS | DROITS | Modification |

## Sécurité

Le XLSX est analysé dans le navigateur. Le widget ne transmet pas son contenu à un serveur applicatif. Il demande l'accès complet uniquement parce que la création de tables et colonnes modifie le document.

## Limites v1.0.0

- ne supprime rien ;
- ne modifie pas automatiquement une colonne existante ;
- ne crée pas les vues/pages Grist ;
- ne gère pas les ACL ;
- ne travaille que dans le document où le widget est installé.

## Licence

MIT pour le code du widget. SheetJS CE est utilisé pour lire les fichiers XLSX.
