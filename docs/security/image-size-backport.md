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
  en-tête de huit octets, tout en normalisant la forme valide `size = 0`
  (« jusqu'à la fin du fichier ») vers une progression bornée ;
- impose une progression strictement croissante dans `findBox`, utilisé par les
  parseurs JXL et HEIF ;
- refuse les longueurs de fichier et d'entrée ICNS nulles, trop courtes ou hors
  limites, sans casser la détection par chemin des ICNS dépassant la fenêtre de
  lecture de 512 Kio.

Le test `src/security/imageSizeBackport.test.ts` exécute les entrées hostiles
dans des processus isolés avec un délai maximal d'une seconde. Il vérifie aussi
des entrées valides JXL/HEIF utilisant une dernière boîte de taille zéro et un
ICNS de plus de 512 Kio via l'API publique, afin qu'une protection qui rejetterait
tout ne puisse pas passer.

`patch-package --error-on-fail` doit être exécuté en CI après l'installation des
dépendances. `npm audit` continuera toutefois à signaler les avis : son calcul
repose sur le numéro de version publié (`1.2.1`) et ne sait pas reconnaître ce
rétroport local.

La CI utilise donc `scripts/npm-audit-guard.mjs`, et non une désactivation de
l'audit. L'exception dans `security/npm-audit-allowlist.json` est limitée aux
deux URL GHSA, au nœud et à la version installés, au SHA-256 exact du patch et à
une échéance de révision au 10 novembre 2026. Toute nouvelle vulnérabilité, tout
déplacement de dépendance ou toute modification du patch bloque à nouveau la
CI. L'alerte reste ainsi visible, ciblée et vérifiable jusqu'à la publication
d'une version amont corrigée.
