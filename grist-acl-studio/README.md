# Grist ACL Studio

Widget Grist autonome pour **lire, expliquer, exporter, simuler et appliquer les règles d'accès avancées (ACL)** d'un document à partir d'un JSON.

## Principe

Le widget ne contacte aucune IA et ne demande aucune clé API Grist.

Workflow :

1. Le widget lit la structure et les ACL du document courant.
2. Il génère un prompt compact contenant uniquement les identifiants de tables, les colonnes utiles aux ACL et les règles actuelles, **jamais les données métier, les formules métier ou les colonnes techniques `gristHelper_*`**.
3. L'utilisateur colle ce prompt dans ChatGPT, Claude, Gandalf ou une autre IA.
4. L'IA renvoie un JSON au format `grist-acl-studio/v1`.
5. L'utilisateur colle ou importe ce JSON dans le widget.
6. Le widget valide le JSON, affiche un tableau de bord lisible et un diff.
7. Après confirmation, il sauvegarde les ACL actuelles puis applique les changements ciblés.

## Sécurité

- `grist.ready({requiredAccess: 'full'})`
- aucune clé API Grist ;
- aucun backend ;
- aucune donnée métier envoyée par le widget ;
- sauvegarde JSON téléchargée avant application ;
- mode V1 : **replace-resources** : seules les ressources explicitement présentes dans le JSON sont remplacées ;
- les règles d'attributs utilisateur sont exportées pour information mais ne sont pas modifiées par défaut ;
- validation bloquante si une ressource modifiée ne contient pas de règle Owner explicite.

## Format JSON V1

```json
{
  "schema": "grist-acl-studio/v1",
  "version": 1,
  "title": "Politique ACL",
  "description": "Résumé humain",
  "mode": "replace-resources",
  "resources": [
    {
      "table": "VEHICULES",
      "columns": "*",
      "description": "Droits sur le parc",
      "rules": [
        {
          "label": "Owner",
          "explanation": "Le propriétaire conserve tous les droits.",
          "when": "user.Access == OWNER",
          "permissions": "all"
        },
        {
          "label": "Repli",
          "explanation": "Tout droit non accordé est refusé.",
          "when": "",
          "permissions": "none"
        }
      ]
    }
  ]
}
```

### `table`

Identifiant technique Grist de la table. `*` est accepté pour une ressource globale.

### `columns`

- `"*"` : toutes les colonnes ;
- chaîne CSV : `"IMMATRICULATION,MARQUE,MODELE"`.

### `permissions`

Accepte :
- `all`
- `none`
- les formes Grist comme `+R`, `+CU`, `+R-CUD`, `-D`.

### Ordre

L'ordre des règles du tableau est conservé. Le widget génère des positions ACL espacées de 1000.

## Application

Pour chaque ressource présente dans le JSON :

- les ressources ACL existantes avec le même couple `table + columns` sont supprimées avec leurs règles ;
- une nouvelle ressource est créée ;
- ses règles sont recréées dans l'ordre du JSON.

Les ressources absentes du JSON ne sont pas modifiées.

## URL GitHub Pages

`https://athenor-lnz.github.io/grist-custom-widgets/grist-acl-studio/`

## Version

0.2.0
