# Rétroport de sécurité `image-size@1.2.1`

Date de vérification : 10 août 2026.

`image-size@1.2.1` est une dépendance transitive de Metro. Les avis
[`GHSA-w3rx-r6r6-pgpr`](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr)
(ICNS) et
[`GHSA-5p2g-fcmc-qvqq`](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)
(JXL/HEIF) couvrent toutes les versions publiées jusqu'à `2.0.2` et n'indiquent
aucune version corrigée. Une rétrogradation de React Native n'est donc pas un
correctif acceptable.

Le correctif local reproductible `patches/image-size+1.2.1.patch` :

- refuse les boîtes ISO BMFF tronquées ou dont la taille est inférieure à leur
  en-tête de huit octets ;
- impose une progression strictement croissante dans `findBox`, utilisé par les
  parseurs JXL et HEIF ;
- refuse les longueurs de fichier et d'entrée ICNS nulles, trop courtes ou hors
  limites.

Le test `src/security/imageSizeBackport.test.ts` exécute chaque parseur dans un
processus isolé avec un délai maximal d'une seconde. Il prouve ainsi qu'un
buffer malformé est rejeté sans pouvoir bloquer le processus Jest lui-même.

`patch-package --error-on-fail` doit être exécuté en CI après l'installation des
dépendances. `npm audit` continuera toutefois à signaler les avis : son calcul
repose sur le numéro de version publié (`1.2.1`) et ne sait pas reconnaître ce
rétroport local. L'alerte ne doit pas être masquée ; ce document, le patch et les
tests constituent la justification vérifiable jusqu'à la publication d'une
version amont corrigée.
