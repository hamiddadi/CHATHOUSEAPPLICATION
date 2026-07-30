# ChatHouse — audit Go-Live Android et iOS

> **Décision au 28 juillet 2026 : NO-GO.**
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

## Préflight reproductible

Le contrôle final unique est `scripts/go-live-preflight.mjs`. Il est en lecture
seule : il ne construit, ne signe, ne téléverse, ne déploie et ne soumet rien.
Il valide des fichiers et artefacts déjà produits pour le même commit :

```bash
node scripts/go-live-preflight.mjs --report artifacts/go-live-preflight.json
```

Le verdict `GO` exige simultanément :

- les environnements mobile/backend et les deux configurations Firebase réels ;
- une clé upload et un AAB non-debug incluant `arm64-v8a`, avec les endpoints
  production effectivement embarqués ;
- une archive `.xcarchive` Apple Distribution, son profil production et le bon
  Team ID ;
- DNS, TLS, pages publiques, `assetlinks.json` et
  `apple-app-site-association` accessibles et cohérents ;
- les documents juridiques et fiches stores sans brouillon ni placeholder ;
- une preuve liée au SHA exact pour Play Internal Testing, TestFlight et les
  tests physiques Android, iPhone et iPad. Le format est fourni dans
  `docs/GO-LIVE-EVIDENCE.example.json`.

Dans GitHub Actions, lancer manuellement **Go-Live Preflight - Android and iOS**
sur un commit déjà intégré à `main`, avec les IDs des runs ayant produit les
artefacts signés. L’environnement GitHub protégé `production` doit fournir :

- secrets : `MOBILE_PRODUCTION_ENV_BASE64`,
  `BACKEND_PRODUCTION_ENV_BASE64`, `FIREBASE_ANDROID_CONFIG_BASE64`,
  `FIREBASE_IOS_CONFIG_BASE64`, `ANDROID_UPLOAD_KEYSTORE_BASE64`,
  `ANDROID_UPLOAD_STORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS` et
  `ANDROID_UPLOAD_KEY_PASSWORD` ;
- variables : `IOS_TEAM_ID`, `ANDROID_APP_SIGNING_SHA256`,
  `GO_LIVE_STORE_EVIDENCE_BASE64` et, si les valeurs par défaut ne conviennent
  pas, `API_HEALTH_URL`, `SUPPORT_URL`, `PRIVACY_URL`, `TERMS_URL`,
  `ACCOUNT_DELETION_URL`, `APP_URL`, `LIVEKIT_HTTPS_URL`.

Le rapport Actions est conservé 90 jours. Un rapport absent, un contrôle sauté
ou un artefact provenant d’un autre commit reste un `NO-GO`.

## État vérifié dans ce workspace

| Zone                  | État                                                                                                                                                                           | Limite de la preuve                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Frontend React Native | Qualité OK ; 92/92 suites et 604/604 tests réussis                                                                                                                             | Les builds natifs signés et les essais sur appareils physiques restent requis.                                         |
| Backend               | Lint, typecheck, build, 65/65 suites (485 tests) et 8 migrations sur base PostgreSQL vierge validés                                                                            | Un clone anonymisé de production, les tests de charge et un déploiement production restent requis.                     |
| Android               | Debug/lint validés ; release TLS-only ; smoke debug ARM64 réussi sur OPPO CPH2043 Android 12 (installation, 2 lancements à froid, navigation onboarding, aucune erreur fatale) | Aucun AAB production signé ; ce smoke ne couvre ni Play Internal ni les parcours réseau, micro et notifications.       |
| iOS                   | Configuration statique, garde d’environnement, AppIcon 1024 × 1024 sans alpha et ressources contrôlées                                                                         | Aucune archive signée ni aucun TestFlight n’a été produit sous Windows.                                                |
| Production            | Non disponible                                                                                                                                                                 | `api.chathouse.app`, `livekit.chathouse.app` et `app.chathouse.com` n’ont pas d’enregistrement DNS A lors du contrôle. |

Ces résultats locaux ont été obtenus après les derniers correctifs. Ils ne
remplacent jamais les tests staging, appareils, TestFlight ou Play Internal
Testing.

## Artefacts techniques à ne jamais publier

Tout APK/AAB déjà présent dans `android/app/build/outputs` est uniquement un
artefact de compilation. Les variantes contrôlées pendant cet audit peuvent
être signées avec `debug.keystore`, limiter les ABI à `x86_64`, embarquer
`.env.test`, pointer vers `localhost:1` et conserver `versionCode=1`. Elles ne
doivent être ni téléversées dans Play Console ni distribuées à des utilisateurs.

## 1. Gate commune — code et données

- [x] `npm run quality` réussit sans avertissement.
- [x] `npm run test:ci` réussit intégralement avec la couverture attendue.
- [x] Backend : lint, typecheck, build et suite complète réussissent
      (65 suites, 485 tests réussis, 1 ignoré ; couverture lignes 71,67 %).
- [ ] Les patches natifs passent `patch-package --error-on-fail`.
- [x] Les huit migrations se déploient sur une base PostgreSQL vide.
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

- [ ] Finaliser la fiche
      `docs/legal/RELEASE-INFORMATION-REQUIRED.md` : identité, litiges et
      responsabilité, prestataires/pays, transferts, conservation, modération,
      sécurité des enfants, version/date et contacts. Propager la version de
      `docs/legal/document-control.json` dans les documents, l’app, le backend et
      les fiches Store. Les placeholders et le statut `draft` interdisent la
      soumission.
- [ ] Publier et vérifier en HTTP 200 les variantes anglaises et françaises
      (`?lang=fr`) des URLs Privacy, Terms, Community Guidelines, Child Safety
      Standards, Support et Account Deletion.
- [ ] Désigner le contact sécurité des enfants dans Play Console, valider le
      processus CSAE/CSAM réel et compléter l’auto-certification Google Play.
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
      L’`AppIcon.png` iOS passe désormais le contrôle technique 1024 × 1024
      sans alpha ; la validation finale de marque et le rendu de l’archive
      signée restent à effectuer avant soumission.
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
