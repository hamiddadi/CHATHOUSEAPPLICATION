# ChatHouse — Guide d'installation & de lancement sur un autre PC

Toutes les commandes pour faire tourner le projet **de zéro** sur une nouvelle machine (macOS, Windows ou Linux).

- **Front** : React Native **0.83.6** _bare_ (⚠️ PAS Expo — `expo` n'est qu'une dépendance transitive neutralisée par `react-native.config.js`).
- **Backend** : Node 20 / TypeScript, Express 5 + Socket.IO, Prisma + PostgreSQL, Redis, LiveKit (audio).
- **Infra** : Docker (PostgreSQL, Redis, LiveKit, coturn optionnel).

> Convention d'écriture : sous **macOS/Linux** on écrit `./gradlew`, sous **Windows (PowerShell)** on écrit `.\gradlew.bat`. Le reste des commandes (`npm`, `npx`, `docker`, `adb`) est identique partout.

---

## 1. Prérequis (versions exactes)

| Outil                    | Version requise                                                                            | Vérifier avec                                  |
| ------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| **Node.js**              | **20.x** (le backend impose `>=20 <21` ; le front tolère plus mais reste sur 20 pour tout) | `node -v`                                      |
| npm                      | fourni avec Node                                                                           | `npm -v`                                       |
| **JDK**                  | **17** (JBR d'Android Studio, ou Temurin 17 — ni 11, ni 21)                                | `java -version`                                |
| **Android SDK**          | compileSdk **36**, minSdk **24**, Build-Tools **36.0.0**, NDK **27.1.12297006**            | Android Studio → SDK Manager                   |
| Gradle                   | **9.0.0** (fourni par le wrapper, téléchargé auto au 1er build)                            | `cd android && ./gradlew --version`            |
| **adb** (platform-tools) | dans le PATH                                                                               | `adb version`                                  |
| **Docker Desktop**       | récent, avec `docker compose`                                                              | `docker --version` && `docker compose version` |

> Astuce Node : utilise **nvm** (`nvm install 20 && nvm use 20`). Le backend refusera de démarrer sous Node 21+ ou 19-.

**Variables d'environnement système Android** (à définir une fois) :

- macOS/Linux : `export ANDROID_HOME=$HOME/Library/Android/sdk` (macOS) ou `$HOME/Android/Sdk` (Linux), puis ajouter `$ANDROID_HOME/platform-tools` au `PATH`.
- Windows : `ANDROID_HOME = C:\Users\<user>\AppData\Local\Android\Sdk`.

---

## 2. Récupérer le code

1. Dézippe l'archive dans un dossier **sans espace ni accent** dans le chemin.
   ✅ `~/Documents/ChatHouse` ❌ `~/Documents/ChatHouse-source 2` (un espace casse la détection de racine RN/Expo).
2. L'archive contient déjà les fichiers normalement ignorés par git et nécessaires au build :
   `android/app/google-services.json` (Firebase), `.env` (front), `backend/.env` (secrets), `react-native.config.js` (fix expo), `android/app/src/debug/res/xml/network_security_config.xml` (HTTP cleartext debug).
   > ⚠️ Ces fichiers contiennent de **vrais secrets** — ne pas rediffuser publiquement.

---

## 3. Backend (à lancer EN PREMIER)

Toutes les commandes depuis le dossier **`backend/`**.

```bash
cd backend

# 3.1 — Dépendances
npm install

# 3.2 — Infra Docker : PostgreSQL (5433) + Redis (6379) + LiveKit (7880)
docker compose up -d postgres redis livekit
#   (coturn est optionnel, inutile en local/LAN : docker compose --profile turn up -d)

# 3.3 — Attendre que Postgres soit prêt
docker compose exec postgres pg_isready -U chathouse    # répéter jusqu'à "accepting connections"

# 3.4 — Prisma : générer le client + créer le schéma
npm run prisma:generate
npx prisma db push          # ⚠️ base VIERGE → db push (PAS "migrate deploy" qui échoue en P3005)

# 3.5 — (optionnel) données de test
npm run seed

# 3.6 — Lancer l'API en mode dev (hot-reload). Écoute sur 0.0.0.0:4000
npm run dev
```

**Ports Docker exposés** : Postgres `127.0.0.1:5433`, Redis `127.0.0.1:6379`, LiveKit `7880/7881` + `41100-41199/udp`. L'API tourne sur l'hôte (port **4000**), pas dans un conteneur, pour le hot-reload.

**Connexion de test sans SMS** : `backend/.env` définit `OTP_TEST_NUMBERS` + `OTP_TEST_CODE`. Ce(s) numéro(s) sautent l'envoi SMS et se connectent avec le code de test (actif hors production uniquement).

---

## 4. Front — préparation JS

Toutes les commandes depuis la **racine du projet**.

```bash
# 4.1 — Dépendances (le postinstall applique patch-package automatiquement)
npm install
```

### 4.2 — Configurer `.env` (racine) selon TON scénario

Les variables sont **inlinées au build par Metro** (`react-native-dotenv`) → **après toute modif de `.env`, redémarre Metro** (Ctrl+C puis `npm start`). Pas de hot-reload sur ces variables.

| Scénario                        | `API_BASE_URL` / `WS_BASE_URL` / `LIVEKIT_URL`                                 |
| ------------------------------- | ------------------------------------------------------------------------------ |
| **Émulateur Android** (même PC) | `http://10.0.2.2:4000/api` · `ws://10.0.2.2:4000` · `ws://10.0.2.2:7880`       |
| **Device USB** (adb reverse)    | `http://127.0.0.1:4000/api` · `ws://127.0.0.1:4000` · `ws://127.0.0.1:7880`    |
| **Device WiFi** (même LAN)      | `http://<IP_LAN_DU_PC>:4000/api` · `ws://<IP_LAN>:4000` · `ws://<IP_LAN>:7880` |

> ⚠️ En USB, utilise l'IP littérale **`127.0.0.1`** (pas `localhost` → risque IPv6 `::1` non tunnelé par adb).
> Trouver l'IP LAN : `ipconfig` (Windows) / `ifconfig | grep inet` (macOS/Linux).

```bash
# 4.3 — Démarrer Metro (bundler JS, port 8081)
npm start
```

---

## 5. Android — build & installation

`local.properties` indique à Gradle où est le SDK. Crée-le si absent :

```bash
# macOS/Linux
echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties     # (Linux: $HOME/Android/Sdk)

# Windows (PowerShell)
"sdk.dir=C:\\Users\\<user>\\AppData\\Local\\Android\\Sdk" | Out-File -Encoding ascii android\local.properties
```

Puis, un device branché (USB, débogage activé) ou un émulateur lancé :

```bash
# Option A — le plus simple (build debug + install + Metro)
npm run android

# Option B — équivalent manuel
#   macOS/Linux :
cd android && ./gradlew app:installDebug && cd ..
#   Windows (PowerShell) :
cd android; .\gradlew.bat app:installDebug; cd ..
```

Autres cibles utiles (depuis `android/`) :

```bash
./gradlew app:assembleDebug                               # APK debug sans install → app/build/outputs/apk/debug/
./gradlew app:assembleRelease                             # APK release (4 propriétés CHATHOUSE_UPLOAD_* obligatoires)
./gradlew app:assembleDebug -PreactNativeArchitectures=arm64-v8a   # build mono-ABI, + rapide
./gradlew app:signingReport                               # SHA-1 (pour Maps/Firebase)
./gradlew clean                                           # purge le cache de build
```

---

## 6. Relier le device au backend (USB / WiFi)

### 6.1 — Device USB : ouvrir les 3 tunnels `adb reverse`

À relancer **après chaque débranchement / reboot du téléphone** :

```bash
adb reverse tcp:4000 tcp:4000     # API
adb reverse tcp:7880 tcp:7880     # LiveKit (audio)
adb reverse tcp:8081 tcp:8081     # Metro (recharge JS en debug)
```

> Si un tunnel se fige : `adb kill-server && adb start-server`, puis relance les 3 lignes.
> Port manquant = panne silencieuse : sans 7880 l'audio ne démarre pas, sans 8081 le JS ne recharge pas.

### 6.2 — Device WiFi : rien à tunneler

Le téléphone joint le PC via l'IP LAN (voir §4.2). **Ouvre le pare-feu** du PC en entrée sur `4000`, `7880`, `8081`. WiFi « invité »/isolé (AP-isolation) = bloqué → repasse en USB.

---

## 7. Google Maps (si la carte est grise)

La clé `GOOGLE_MAPS_API_KEY` du `.env` est restreinte à mon compte (package `com.chathouse.app` + mon SHA-1). Sur une autre machine :

```bash
cd android && ./gradlew app:signingReport      # récupère le SHA1 de la variante "debug"
```

Puis dans **Google Cloud Console → APIs & Services → Credentials → clé Maps → Android apps**, ajoute :
`com.chathouse.app` + le SHA-1 obtenu. (Ou utilise ta propre clé Maps dans `.env`.)

---

## 8. Dépannage (erreurs fréquentes)

| Erreur                                                                                       | Cause / solution                                                                                                                                              |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `File google-services.json is missing`                                                       | Fichier présent dans `android/app/` (inclus). Vérifier qu'il n'a pas été perdu au dézippage.                                                                  |
| `Plugin with id 'expo-module-gradle-plugin' not found` / `:expo does not specify compileSdk` | Expo autolinké par erreur. **Corrigé** par `react-native.config.js` (inclus). Si ça persiste : chemin sans espace (§2), puis `cd android && ./gradlew clean`. |
| `SDK location not found`                                                                     | `android/local.properties` absent ou mauvais `sdk.dir` (§5), ou `ANDROID_HOME` non défini.                                                                    |
| JDK / Gradle échoue                                                                          | Mauvaise version de JDK → forcer **JDK 17** (`java -version`).                                                                                                |
| Build Android **OOM**                                                                        | Build mono-ABI : `./gradlew app:assembleDebug -PreactNativeArchitectures=arm64-v8a`.                                                                          |
| Backend : DB refuse la connexion                                                             | Docker pas lancé → `docker compose up -d postgres redis`. Le port est **5433** (pas 5432).                                                                    |
| Backend : Redis error au démarrage                                                           | `docker compose up -d redis` avant `npm run dev`.                                                                                                             |
| `prisma migrate deploy` → **P3005**                                                          | Base vierge → utiliser `npx prisma db push`.                                                                                                                  |
| App : « Connexion perdue » / rooms ne chargent pas                                           | `.env` ne pointe pas vers le bon backend (§4.2) ou API pas démarrée ou tunnels adb manquants (§6).                                                            |
| Audio (rooms vocales) muet                                                                   | LiveKit pas lancé (`docker compose up -d livekit`) ou `adb reverse tcp:7880` manquant.                                                                        |
| Carte Maps grise                                                                             | Clé Maps restreinte à mon compte → §7.                                                                                                                        |
| Modifs `.env` ignorées                                                                       | Redémarrer Metro (les variables sont inlinées au bundle).                                                                                                     |

---

## 9. Récapitulatif express (copier-coller)

### macOS / Linux (le cas de Sofiane)

```bash
# --- Terminal 1 : BACKEND ---
cd backend
npm install
docker compose up -d postgres redis livekit
npm run prisma:generate && npx prisma db push
npm run dev

# --- Terminal 2 : FRONT (racine) ---
npm install
echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties   # 1re fois seulement
# éditer .env selon le scénario (§4.2)
npm start

# --- Terminal 3 : ANDROID (racine) ---
adb reverse tcp:4000 tcp:4000 && adb reverse tcp:7880 tcp:7880 && adb reverse tcp:8081 tcp:8081   # si USB
npm run android
```

### Windows (PowerShell)

```powershell
# --- Terminal 1 : BACKEND ---
cd backend
npm install
docker compose up -d postgres redis livekit
npm run prisma:generate; npx prisma db push
npm run dev

# --- Terminal 2 : FRONT (racine) ---
npm install
"sdk.dir=C:\Users\<user>\AppData\Local\Android\Sdk" | Out-File -Encoding ascii android\local.properties
# éditer .env selon le scénario (§4.2)
npm start

# --- Terminal 3 : ANDROID (racine) ---
adb reverse tcp:4000 tcp:4000; adb reverse tcp:7880 tcp:7880; adb reverse tcp:8081 tcp:8081   # si USB
npm run android
```

**Ordre de démarrage** : Docker → backend (`npm run dev`) → Metro (`npm start`) → `npm run android`.
