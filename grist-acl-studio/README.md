# Grist ACL Studio

Widget Grist autonome pour **comprendre les permissions avancées et appliquer un JSON de règles généré par une IA**.

## Philosophie v0.3

Le widget ne cherche plus à remplacer l'éditeur natif de Grist.

Il ajoute uniquement ce qui lui manque :

- une vue simple **Tables → Règles → Qui peut quoi ?** ;
- un **mode expert** pour afficher les formules ACL ;
- un bouton **Copier pour l'IA** qui génère un prompt compact sans données métier ;
- un **import JSON** avec validation, comparaison et sauvegarde automatique avant application.

## Sécurité

- aucun backend ;
- aucune clé API Grist ;
- aucune donnée métier envoyée ;
- le prompt ne contient que les identifiants de tables, colonnes utiles et ACL actuelles ;
- seules les ressources présentes dans le JSON sont remplacées ;
- sauvegarde JSON avant toute application.

## URL

https://athenor-lnz.github.io/grist-custom-widgets/grist-acl-studio/

## Version

0.3.0
