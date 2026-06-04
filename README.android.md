# Chathouse — Android : build, run & connexion (device réel)

Guide pour lancer l'app Android sur un téléphone physique, avec le backend local.
Plate-forme de référence : Windows + appareil Android branché en USB (débogage activé).

## 1. Prérequis

- **Node** + dépendances : `npm install`
- **Android SDK** (platform-tools dans le PATH, ou via `~/AppData/Local/Android/Sdk`)
- **JDK 17** (fourni par Android Studio `jbr`, ou Temurin 17)
- **Docker Desktop** (Postgres + Redis pour le backend)
- Machine RAM-limitée (8 Go) : le build est configuré en **mono-ABI `arm64-v8a`**
  (plugin [`plugins/with-gradle-jvm-heap.js`](plugins/with-gradle-jvm-heap.js)).
  Pour un émulateur x86_64 : `npx expo run:android -- -PreactNativeArchitectures=x86_64`.

## 2. Variables d'environnement (`.env` à la racine)

Copier `.env.example` → `.env` et renseigner. **`.env` est gitignored.**

| Variable                       | Rôle                                                                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_BASE_URL` / `WS_BASE_URL` | API + WebSocket backend. `http://127.0.0.1:4000/api` en mode **USB** (voir §5), ou l'**IP LAN** du PC (ex. `http://10.1.1.90:4000/api`) en WiFi.                                    |
| `LIVEKIT_URL`                  | Serveur LiveKit (audio). `ws://127.0.0.1:7880` (USB) ou IP LAN.                                                                                                                     |
| `REALTIME_ENABLED`             | `true` pour activer le socket temps réel.                                                                                                                                           |
| **`GOOGLE_MAPS_API_KEY`**      | **Requis** : sans clé, l'onglet Carte **crashe** (react-native-maps init le SDK Google même si l'app affiche des tuiles OSM). Injectée au manifest au prebuild via `app.config.js`. |

> L'`.env` racine porte l'IP LAN du PC — elle **périme au changement de réseau**.
> Après édition, **redémarrer Expo / rebuild** pour réinjecter les valeurs.

## 3. Backend

```bash
# Postgres + Redis
docker compose up -d            # (ou les conteneurs chathouse-postgres / chathouse-redis)

cd backend
npx prisma db push              # PAS `migrate deploy` (évite P3005 sur base existante)
npm run dev                     # écoute sur 0.0.0.0:4000
```

En dev, l'OTP n'est pas envoyé par SMS : il est **loggé** par le stub
(`[sms-stub] → +213… :: Your Chathouse code: 123456`).

## 4. Build de l'app

```bash
# Debug (JS servi par Metro) — démarrage lent, dépend de Metro
npx expo run:android

# Release autonome (JS + assets embarqués, démarrage rapide, sans Metro)
cd android && ./gradlew :app:assembleRelease
# APK : android/app/build/outputs/apk/release/app-release.apk
```

Le release est signé avec la **clé debug** (cf. `android/app/build.gradle`) →
installable directement. La désactivation de l'upload Sentry au build local :
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

Le **cleartext HTTP** est autorisé en release uniquement pour localhost/émulateur
via [`plugins/with-cleartext-localhost.js`](plugins/with-cleartext-localhost.js)
(les domaines de prod restent en HTTPS).

## 6. Google Maps — clé & restriction

1. Google Cloud Console → activer **« Maps SDK for Android »** → créer une clé Android.
2. La mettre dans `.env` (`GOOGLE_MAPS_API_KEY=…`) et en **secret EAS** pour les builds cloud :
   `eas secret:create --name GOOGLE_MAPS_API_KEY --value <clé>`
3. **Restreindre** la clé : application Android `com.chathouse.app` + empreinte SHA‑1 de signature.
   - SHA‑1 du keystore **debug** (signe debug+release actuels) :
     `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`
   - Récupérer une empreinte : `keytool -list -v -keystore <keystore> -alias <alias>`
   - En prod, utiliser un **vrai keystore release** et ajouter SON SHA‑1.

## 7. Dépannage (problèmes déjà corrigés)

| Symptôme                                                     | Cause / correctif                                                                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Build Gradle **OOM** (8 Go)                                  | mono-ABI `arm64-v8a` + heaps bornés (`with-gradle-jvm-heap`).                                                         |
| Crash boot `NoClassDefFoundError: …AnyTypeCache`             | `expo-audio` tirait `expo-asset@56` (SDK 56). Override `expo-asset@~55.0.17` dans `package.json`.                     |
| **Écran blanc** au lancement                                 | `useFonts` qui ne résout pas → timeout 4s dans `src/core/App.tsx`.                                                    |
| Crash **release** `Invalid expression encountered` (hermesc) | `import()` dynamique rejeté par Hermes → `require()` (hooks extensions) + stub Metro pour modules optionnels absents. |
| Backend ne démarre pas : `Redis client is closed`            | Connexion Redis _eager_ à l'import (`backend/src/config/redis.ts`).                                                   |
| App « couldn't reach the server » en release                 | Cleartext HTTP bloqué → `with-cleartext-localhost` (localhost only).                                                  |
| Onglet **Carte** crashe (`API key not found`)                | Clé Google Maps manquante → `GOOGLE_MAPS_API_KEY` (voir §6).                                                          |
