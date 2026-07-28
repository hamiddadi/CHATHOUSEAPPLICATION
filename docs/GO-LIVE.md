# ChatHouse — audit Go-Live Android et iOS

> **Décision au 20 juillet 2026 : NO-GO.**
>
> Le dépôt a été fortement durci, mais cette version ne doit pas encore être
> envoyée en production ni soumise aux stores. Il manque des artefacts signés
> avec les secrets réels, une archive iOS produite sur macOS, l’infrastructure
> publique, les validations sur appareils physiques, les formalités des deux
> consoles et les informations juridiques définitives.
>
> Une application ne peut jamais être garantie « fonctionnelle à 100 % ». Le
> Go-Live doit être fondé sur les preuves reproductibles ci-dessous, puis
> surveillé avec un rollback opérationnel.

La variable GitHub `PUBLIC_RELEASE_ENABLED` doit rester absente ou à `false`
jusqu’à ce que toutes les cases obligatoires soient accompagnées d’une preuve.

## État vérifié dans ce workspace

| Zone                  | État                                                                             | Limite de la preuve                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Frontend React Native | En revalidation finale                                                           | Les suites complètes doivent être rejouées après le dernier correctif.                                                 |
| Backend               | Migration 8/8 et tests ciblés critiques validés                                  | La suite complète finale et un clone de la base de production restent requis.                                          |
| Android               | `compileSdk`/`targetSdk` 36, manifeste Release et configuration Firebase valides | Les artefacts techniques actuels utilisent `.env.test`, x86_64 et la clé debug.                                        |
| iOS                   | Configuration statique et garde d’environnement contrôlées                       | Aucun build signé, aucune archive Xcode et aucun TestFlight n’ont été produits sous Windows.                           |
| Production            | Non disponible                                                                   | `api.chathouse.app`, `livekit.chathouse.app` et `app.chathouse.com` n’ont pas d’enregistrement DNS A lors du contrôle. |

Les résultats chiffrés de la dernière exécution cohérente seront consignés ici
après la fin des validations. Un succès local ne remplace jamais les tests
staging, appareils, TestFlight ou Play Internal Testing.

## Artefacts techniques à ne jamais publier

Tout APK/AAB déjà présent dans `android/app/build/outputs` est uniquement un
artefact de compilation. Les variantes contrôlées pendant cet audit peuvent
être signées avec `debug.keystore`, limiter les ABI à `x86_64`, embarquer
`.env.test`, pointer vers `localhost:1` et conserver `versionCode=1`. Elles ne
doivent être ni téléversées dans Play Console ni distribuées à des utilisateurs.

## 1. Gate commune — code et données

- [ ] `npm run quality` réussit sans avertissement.
- [ ] `npm run test:ci` réussit intégralement avec la couverture attendue.
- [ ] Backend : lint, typecheck, build et suite complète réussissent.
- [ ] Les patches natifs passent `patch-package --error-on-fail`.
- [ ] Les huit migrations se déploient sur une base PostgreSQL vide.
- [ ] `prisma migrate deploy` réussit sur un clone récent et anonymisé de la
      production, sans `db push`, perte de données ni verrou excessif.
- [ ] La migration suit un schéma expand/contract rétrocompatible avec l’image
      précédente.
- [ ] Les compose, scripts de déploiement, règles Prometheus et configuration
      Alertmanager passent leurs validateurs.
- [ ] La sauvegarde hors site et une restauration complète sur base propre sont
      exécutées et chronométrées avec le digest candidat exact. Le drill ne
      trouve aucune migration Prisma échouée et son `migrate status` final est
      propre.

## 2. Gate Android

Références détaillées :
[`RELEASE-SIGNING.md`](RELEASE-SIGNING.md),
[`build-and-submit.md`](store/build-and-submit.md) et
[`README.env.md`](../README.env.md).

- [x] Package `com.chathouse.app`, `compileSdk=36` et `targetSdk=36`.
- [x] Le `google-services.json` local contient un client configuré pour le bon
      package. Ne jamais committer ce fichier.
- [x] La garde Gradle refuse une Release sans les quatre propriétés de
      signature et refuse la clé debug sans opt-in technique explicite.
- [ ] Créer `.env.production` avec uniquement des endpoints publics
      `https://`/`wss://`, `REALTIME_ENABLED=true`, LiveKit réel et une clé Maps
      restreinte. Le script de build doit valider le fichier.
- [ ] Installer et sauvegarder hors dépôt la vraie clé d’upload Play ; fournir
      les quatre `CHATHOUSE_UPLOAD_*`.
- [ ] Choisir explicitement un `versionCode` inutilisé et un `versionName`.
- [ ] Générer l’AAB **toutes ABI** via
      `.\scripts\build-release-aab.ps1 -VersionCode N -VersionName X.Y.Z`.
- [ ] Vérifier la signature d’upload, l’alignement 16 Kio et chaque bibliothèque
      native de l’AAB final.
- [ ] Téléverser d’abord sur Play Internal Testing et enregistrer l’empreinte
      Play App Signing dans Firebase et les restrictions Google Maps.
- [ ] Publier
      `https://app.chathouse.com/.well-known/assetlinks.json` avec l’empreinte
      Play App Signing, puis vérifier les App Links sur un binaire installé par
      Play.
- [ ] Tester physiquement Android 12 à 16 : OTP, refus/acceptation micro,
      Bluetooth, audio en arrière-plan, interruption audio, localisation
      approximative/précise, notifications au premier plan/arrière-plan/app
      fermée, réseau faible, deep links et suppression du compte.
- [ ] Compléter Data Safety, IARC, la déclaration des foreground services
      `microphone`/`mediaPlayback`, la vidéo demandée, les captures et le
      pre-launch report.
- [ ] Si le compte Play est concerné, réaliser le test fermé requis avant
      l’accès production.

## 3. Gate iOS

- [ ] Exécuter le build avec macOS et Xcode 26 ou version plus récente.
- [ ] Installer le vrai `ios/ChatHouse/GoogleService-Info.plist` hors dépôt.
- [ ] Configurer Apple Team ID, certificat Distribution, profil App Store,
      capacités Push Notifications et App Store Connect API.
- [ ] Générer et versionner les fichiers de verrouillage Bundler/CocoaPods
      nécessaires à un build reproductible.
- [ ] Créer `.env.production` et confirmer que la garde Release-device refuse
      `.env.test`, localhost et les transports non chiffrés.
- [ ] Incrémenter `CURRENT_PROJECT_VERSION` et choisir le
      `MARKETING_VERSION`.
- [ ] Produire une archive signée `iphoneos` avec Xcode, valider l’archive,
      exporter le rapport de confidentialité fusionné et confirmer la
      déclaration de chiffrement pour LiveKit/WebRTC.
- [ ] Publier
      `https://app.chathouse.com/.well-known/apple-app-site-association` avec le
      Team ID réel, puis vérifier Universal Links.
- [ ] Distribuer exactement cette archive sur TestFlight.
- [ ] Tester sur iPhone **et iPad** physiques : APNs/FCM, notifications app
      fermée, micro, audio Bluetooth, arrière-plan, interruptions, parole,
      localisation, LiveKit, réseau faible, reprise après crash et suppression.
- [ ] Compléter App Privacy, la classification d’âge actuelle, les informations
      de review, les captures iPhone/iPad et les coordonnées de support.

## 4. Gate backend et production

Référence : [`runbook.md`](../backend/docs/deployment/runbook.md).

- [ ] Provisionner l’hôte, Postgres, Redis, stockage objet, sauvegardes, DNS et
      TLS. Les domaines API, LiveKit, support et deep links doivent répondre
      publiquement avec un certificat valide.
- [ ] Renseigner tous les secrets de production : JWT, métriques, Postgres,
      Redis, Twilio, Resend, Firebase/ADC, S3, LiveKit, Stripe et éventuellement
      Sentry. Aucun mode stub ne doit rester actif.
- [ ] Vérifier sur staging les vrais SMS/e-mails, push FCM/APNs, média privé,
      LiveKit, webhooks Stripe et purge RGPD.
- [ ] Tester Prometheus/Grafana/Alertmanager et recevoir une vraie alerte de
      bout en bout.
- [ ] Promouvoir le même digest d’image validé en staging.
- [ ] Exécuter smoke tests externes avec délais bornés, puis un exercice de
      rollback qui revalide l’ancienne image.
- [ ] Confirmer les reviewers et secrets des environnements GitHub staging et
      production.

## 5. Gate sécurité, UGC, juridique et stores

- [ ] Finaliser l’entité légale, l’adresse, la juridiction, les transferts,
      l’autorité de contrôle et les e-mails opérationnels dans
      `docs/legal/*` et sur les pages publiques. Les placeholders interdisent la
      soumission.
- [ ] Publier et vérifier en HTTP 200 les URLs Privacy, Terms, Support et Account
      Deletion.
- [ ] Faire valider les textes par un conseil et enregistrer l’acceptation
      explicite de la version publiée des conditions.
- [ ] Vérifier dans les binaires finaux le signalement de contenu individuel,
      d’utilisateur et de room, le blocage et le traitement dans la console
      d’administration.
- [ ] Mettre en place une équipe de modération, une astreinte, des délais de
      réponse et une procédure d’escalade. Le filtre textuel local reste une
      défense de base ; il ne modère pas à lui seul l’audio ou les images.
- [ ] Réconcilier les formulaires Apple/Google avec le binaire signé, les SDK
      réellement embarqués et les contrats fournisseurs, notamment Google Maps.
- [ ] Produire toutes les captures, icônes, feature graphics, descriptions,
      coordonnées de review et comptes de démonstration demandés.
- [ ] Maintenir les achats numériques et pourboires désactivés dans les builds
      mobiles tant qu’un parcours conforme StoreKit/Google Play Billing n’est
      pas livré et approuvé.

## 6. Ordre d’activation

1. Fermer toutes les cases des sections 1, 4 et 5 sur staging.
2. Générer les artefacts signés Android/iOS à partir du même commit et conserver
   leurs empreintes.
3. Valider Play Internal Testing et TestFlight sur appareils physiques.
4. Corriger tout échec, reconstruire et recommencer les tests sur les nouveaux
   artefacts ; ne jamais promouvoir un binaire différent de celui testé.
5. Obtenir l’approbation humaine release, sauvegarde et modération.
6. Passer `PUBLIC_RELEASE_ENABLED=true`, déployer le digest approuvé, soumettre
   progressivement, surveiller les alertes/crashs/vitals et conserver le
   rollback prêt.

La décision ne devient **GO** que lorsque toutes les cases obligatoires sont
fermées par des preuves datées. En l’état actuel, elle reste **NO-GO**.
