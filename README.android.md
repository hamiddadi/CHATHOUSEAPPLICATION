# ChatHouse — Android : build, run & connexion (device réel)

Guide pour lancer l'app Android sur un téléphone physique, avec le backend local.
Plate-forme de référence : Windows + appareil Android branché en USB (débogage activé).

## 1. Prérequis

- **Node** + dépendances : `npm install`
- **Android SDK** (platform-tools dans le PATH, ou via `~/AppData/Local/Android/Sdk`)
- **JDK 17** (fourni par Android Studio `jbr`, ou Temurin 17)
- **Docker Desktop** (Postgres + Redis pour le backend)
- Le projet est une application **bare React Native** : les builds natifs passent
  directement par Gradle, sans Expo/EAS.
- Les artefacts de distribution incluent les quatre ABI configurées
  (`armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64`). Pour accélérer un build local,
  limiter explicitement les ABI sur la ligne de commande, par exemple
  `cd android && .\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64`.

## 2. Variables d'environnement (`.env` à la racine)

Copier `.env.example` → `.env` et renseigner. **`.env` est gitignored.**

| Variable                       | Rôle                                                                                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_BASE_URL` / `WS_BASE_URL` | API + WebSocket backend. `http://127.0.0.1:4000/api` en mode **USB** (voir §5), ou l'**IP LAN** du PC (ex. `http://10.1.1.90:4000/api`) en WiFi.                                              |
| `LIVEKIT_URL`                  | Serveur LiveKit (audio). `ws://127.0.0.1:7880` (USB) ou IP LAN.                                                                                                                               |
| `REALTIME_ENABLED`             | `true` pour activer le socket temps réel.                                                                                                                                                     |
| **`GOOGLE_MAPS_API_KEY`**      | **Requis** : sans clé, l'onglet Carte **crashe** (react-native-maps initialise le SDK Google même si l'app affiche des tuiles OSM). Injectée dans le manifest par `android/app/build.gradle`. |

> L'`.env` racine porte l'IP LAN du PC — elle **périme au changement de réseau**.
> Après édition, **redémarrer Metro et reconstruire l'application** pour
> réinjecter les valeurs.

## 3. Backend

```bash
# Postgres + Redis
docker compose up -d            # (ou les conteneurs chathouse-postgres / chathouse-redis)

cd backend
npx prisma migrate deploy       # applique la chaîne versionnée, comme en CI/prod
npm run dev                     # écoute sur 0.0.0.0:4000
```

Ne jamais remplacer cette étape par `prisma db push` : cela masque les dérives
de migration et ne reproduit pas le chemin de déploiement.

En dev, l'OTP n'est pas envoyé par SMS : il est **loggé** par le stub
(`[sms-stub] → +213… :: Your ChatHouse code: 123456`).

## 4. Build de l'app

```powershell
# Debug (JS servi par Metro) — démarrage lent, dépend de Metro
npm run android

# Release autonome de production (JS + assets embarqués, sans Metro).
# Depuis la racine, requiert .env.production et les 4 propriétés
# CHATHOUSE_UPLOAD_* décrites dans docs/RELEASE-SIGNING.md :
.\scripts\build-release-aab.ps1 -VersionCode 42 -VersionName 1.4.0 -Apk
# APK : android/app/build/outputs/apk/release/app-release.apk
```

Le script exige la **clé upload privée** et ne retombe jamais sur la clé debug.
Ne pas utiliser un `gradlew assembleRelease` brut pour un artefact Store. Pour
un APK local autonome explicitement signé avec la clé debug,
utiliser `npm run apk:build`. La désactivation de l'upload Sentry au build local :
`SENTRY_DISABLE_AUTO_UPLOAD=true`.

## 5. Installer + connecter sur le téléphone (USB)

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk

# Tunnel USB : le téléphone atteint le backend du PC via localhost
adb reverse tcp:4000 tcp:4000     # API + WebSocket
adb reverse tcp:7880 tcp:7880     # LiveKit
adb reverse tcp:8081 tcp:8081     # Metro (build debug uniquement)
```

> Utiliser `127.0.0.1` (IPv4) dans `.env`, **pas `localhost`** : Android peut
> résoudre `localhost` en IPv6 `::1` que `adb reverse` (IPv4) ne tunnelise pas.
>
> Le tunnel `adb reverse` **saute quand le téléphone se met en veille**. S'il ne
> répond plus : `adb kill-server && adb start-server` puis re-`adb reverse`.
> Alternative plus stable : téléphone + PC sur le **même WiFi**, IP LAN dans
> `.env`, port 4000 ouvert au pare-feu Windows.

Le **cleartext HTTP** est autorisé en release uniquement pour les hôtes locaux
déclarés dans
[`android/app/src/main/res/xml/network_security_config.xml`](android/app/src/main/res/xml/network_security_config.xml)
; les autres domaines, notamment la production, restent obligatoirement en
HTTPS.

## 6. Google Maps — clé & restriction

1. Google Cloud Console → activer **« Maps SDK for Android »** → créer une clé Android.
2. La mettre dans `.env` (`GOOGLE_MAPS_API_KEY=…`) pour le développement. Pour
   une Release, le script `scripts/build-release-aab.ps1` la lit depuis
   `.env.production` et la transmet à Gradle.
3. **Restreindre** la clé : application Android `com.chathouse.app` + empreinte SHA‑1 de signature.
   - SHA‑1 du keystore **debug** (build debug + builder APK local uniquement) :
     `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`
   - Récupérer une empreinte : `keytool -list -v -keystore <keystore> -alias <alias>`
   - En prod, utiliser un **vrai keystore release** et ajouter SON SHA‑1.

## 7. Dépannage (problèmes déjà corrigés)

| Symptôme                                                     | Cause / correctif                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Build Gradle **OOM** (8 Go)                                  | Workers/heaps bornés dans `android/gradle.properties` ; limiter temporairement les ABI sur la ligne de commande pour un build local. |
| **Écran blanc** au lancement                                 | `useFonts` qui ne résout pas → timeout 4s dans `src/core/App.tsx`.                                                                   |
| Crash **release** `Invalid expression encountered` (hermesc) | `import()` dynamique rejeté par Hermes → `require()` (hooks extensions) + stub Metro pour modules optionnels absents.                |
| Backend ne démarre pas : `Redis client is closed`            | Connexion Redis _eager_ à l'import (`backend/src/config/redis.ts`).                                                                  |
| App « couldn't reach the server » en release                 | Cleartext HTTP limité par la configuration native `network_security_config.xml`.                                                     |
| Onglet **Carte** crashe (`API key not found`)                | Clé Google Maps manquante → `GOOGLE_MAPS_API_KEY` (voir §6).                                                                         |
