# Dossier juridique ChatHouse

État au 29 juillet 2026 : les modèles sont structurés et disponibles en anglais
et en français, mais ils restent **non publiables** tant que les faits signalés
entre crochets n’ont pas été confirmés et validés juridiquement.

La source de contrôle lisible par machine est
[`document-control.json`](document-control.json). Sa version doit rester
identique dans les huit documents, le backend, l’application mobile et les
trois fiches Store. Le champ `status` ne peut passer de `draft` à `published`
qu’après remplacement des champs humains, validation juridique et fixation
d’une date d’entrée en vigueur.

| Document                          | Anglais                                                | Français                                                     |
| --------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| Politique de confidentialité      | [PRIVACY-POLICY.md](PRIVACY-POLICY.md)                 | [PRIVACY-POLICY.fr.md](PRIVACY-POLICY.fr.md)                 |
| Conditions / EULA                 | [EULA.md](EULA.md)                                     | [EULA.fr.md](EULA.fr.md)                                     |
| Règles communautaires             | [COMMUNITY-GUIDELINES.md](COMMUNITY-GUIDELINES.md)     | [COMMUNITY-GUIDELINES.fr.md](COMMUNITY-GUIDELINES.fr.md)     |
| Standards de sécurité des enfants | [CHILD-SAFETY-STANDARDS.md](CHILD-SAFETY-STANDARDS.md) | [CHILD-SAFETY-STANDARDS.fr.md](CHILD-SAFETY-STANDARDS.fr.md) |

La fiche [RELEASE-INFORMATION-REQUIRED.md](RELEASE-INFORMATION-REQUIRED.md)
regroupe toutes les informations que le propriétaire doit fournir.

## Règles de publication

1. Confirmer l’identité, la juridiction, les contacts, les fournisseurs, les
   transferts, la conservation et les procédures opérationnelles.
2. Faire valider les deux langues par un conseil compétent dans les pays de
   lancement.
3. Remplacer tous les champs entre crochets et supprimer les avertissements de
   brouillon uniquement après validation.
4. Affecter une version et une date d’entrée en vigueur immuables dans
   `document-control.json`, puis propager exactement cette version dans les
   documents, le backend, l’application et les fiches Store.
5. Publier les pages en HTTPS, vérifier leur contenu et tester les boîtes de
   contact.
6. Enregistrer l’acceptation explicite de la version des Conditions avant toute
   publication de contenu utilisateur et conserver la preuve.
7. Archiver la validation juridique, les réponses App Store/Play Console et les
   preuves de test.

Le contrôle automatisé reste volontairement en échec tant qu’un brouillon ou un
placeholder subsiste :

```powershell
node scripts/go-live-preflight.mjs --scope legal
```
