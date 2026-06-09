# 10 - Recommandations d'instrumentation pour le debug pendant les tests

> **Application** : ChatHouse — audio live façon Clubhouse. React Native / Expo, temps réel WebSocket (Socket.IO) + audio LiveKit (`@livekit/react-native`, build EAS dev-client requis pour la voix), push, i18n FR/EN, rôles guest/standard/admin, Android + iOS, réseaux variables (3G/4G/5G/Wi-Fi, pertes/latence/reconnexion).
> **But de ce document** : rendre chaque bug — surtout temps-réel — **reproductible et traçable**. On capitalise sur l'existant (`/metrics` Prometheus backend, diag par delta de compteur, Sentry backend) et on comble les trous côté app pour que QA puisse joindre des **traces exploitables** à chaque rapport.
> **Parc testé** : 50 écrans, 381 boutons, 991 cas. Voir aussi `03-scenarios-temps-reel.md` (scénarios multi-acteurs) et `04-plan-reseau.md` (profils P1…P12).

## 0. Existant à réutiliser (ne pas réinventer)

| Brique                     | Où                                                                                                                        | Ce qu'on en tire                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Métriques Prometheus       | `backend/src/monitoring/metrics.ts`, endpoint `GET /metrics` (token `METRICS_TOKEN` en prod)                              | Préfixe `chathouse_*`, `chathouse_ws_connections`, `chathouse_http_request_duration_seconds`, métriques par défaut Node/GC/event-loop |
| Diag par delta de compteur | scrape `/metrics` à T0 puis T1, soustraire                                                                                | Mesure d'un flux (req/s, connexions WS gagnées/perdues) sans Grafana                                                                  |
| Sentry backend             | `backend/src/monitoring/sentry.ts`, init dans `startServer()`                                                             | Exceptions serveur + breadcrumbs HTTP                                                                                                 |
| Reporter app (crash)       | `src/core/observability/reporter.ts`                                                                                      | Wrapper Sentry RN **gaté par consentement RGPD** ; no-op en dev (log console) et sans consentement                                    |
| FSM statut socket          | `src/shared/services/realtime/socketStore.ts` (`idle/connecting/connected/disconnected/reconnecting`) + `socketClient.ts` | Source de vérité du cycle WS, déjà horodatée (`lastTransitionAt`)                                                                     |
| Ping RTT socket            | `measureRtt()` dans `socketClient.ts` (event `rtt:ping`, ack, défaut 5 000 ms)                                            | Latence aller-retour signalisation                                                                                                    |
| Statut audio LiveKit       | `useRoomAudio` (`idle/connecting/live/reconnecting/error/unsupported`) + `roomAudioService.ts`                            | Cycle de vie audio, rejoin 5× backoff 2 s→30 s, renouvellement token ~30 s avant expiration                                           |
| Logger backend             | `backend/src/config/logger`, `morgan` → `logger.info`                                                                     | Logs HTTP serveur structurés                                                                                                          |

> **Règle d'or** : toute nouvelle instrumentation côté app est **gatée et muette par défaut** (voir §1.4 redaction + §1.5 activation), pour ne pas créer de fuite PII ni de bruit en production. Le debug verbeux s'active via feature flag / overlay QA, jamais par défaut sur un build store.

---

## 1. Logs côté app — à ajouter et structurer

Aujourd'hui le code applicatif n'a quasi pas de logs structurés (quelques `console.*` épars : `env.ts`, `reporter.ts`, `healthProbe.ts`, `errorHandler.ts`, `pushService.ts`, `useVoiceRecorder.ts`). On introduit **un logger unique** côté app, par-dessus lequel toute trace passe.

### 1.1 Module logger proposé

Créer `src/core/observability/logger.ts` (frère de `reporter.ts`) exposant :

```ts
type Level = 'debug' | 'info' | 'warn' | 'error';
interface LogContext {
  sessionId?: string;   // corrélation session (1 par lancement d'app)
  roomId?: string;      // corrélation room
  messageId?: string;   // corrélation message / conversation
  userId?: string;      // REDIGÉ par défaut (voir 1.4)
  ev?: string;          // nom d'événement (ws:connect, lk:track_published, …)
  [k: string]: unknown;
}
log(level: Level, msg: string, ctx?: LogContext): void;
```

Comportement attendu :

- **Format JSON sur une ligne** (logcat/idevicesyslog/Reactotron parsables, `jq`-friendly).
- **Niveaux** : `debug` (verbeux, OFF sauf overlay QA), `info` (cycle de vie), `warn` (dégradation récupérable : reconnexion, retry), `error` (échec non récupérable).
- En dev / overlay QA : `console.*`. En prod avec consentement : pousse `info+`/`warn+` en **Sentry breadcrumb** (`reportMessage`) pour qu'ils apparaissent dans la timeline d'un crash.
- Ne **jamais** logguer un token, un OTP, un numéro de téléphone, un vrai nom, le contenu d'un message (voir §1.4).

### 1.2 Format de ligne (exemple)

```json
{
  "t": "2026-06-09T10:21:04.512Z",
  "lvl": "info",
  "ev": "ws:connect",
  "msg": "socket connected",
  "sessionId": "s_a1b2c3",
  "roomId": null,
  "transport": "websocket",
  "attempt": 1
}
```

```json
{
  "t": "2026-06-09T10:22:31.004Z",
  "lvl": "warn",
  "ev": "lk:reconnecting",
  "msg": "livekit lost link, auto-retry",
  "sessionId": "s_a1b2c3",
  "roomId": "room-rt-1",
  "rejoinAttempt": 2,
  "backoffMs": 4000
}
```

### 1.3 Correlation IDs (clé du debug temps-réel)

| ID                             | Portée                             | Génération / source                                                                                                                               |
| ------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionId`                    | 1 par lancement d'app (cold start) | UUID local, stocké en mémoire ; ré-émis dans **tout** log + en `X-Session-Id` sur les requêtes Axios + dans le handshake socket (`auth` callback) |
| `roomId`                       | Présence en room                   | déjà connu (`useRoomAudio({roomId})`, `useRoomSocket`) ; ajouté au contexte tant qu'on est dans la room                                           |
| `messageId` / `conversationId` | Messagerie 1:1 et groupe           | clé React Query (`messageKeys`, `groupKeys`) ; utile pour relier un `chat:message` reçu à l'UI                                                    |
| `userId`                       | Acteur                             | **toujours rédigé** par défaut (hash court ou `__self__` / `peer#n`), valeur claire seulement en overlay QA                                       |

> **Pourquoi** : un bug RT implique ≥ 2 acteurs (`03-scenarios-temps-reel.md`). Avec le même `roomId` dans les logs des 2 devices **et** dans `/metrics`, QA peut aligner les timelines à la seconde. Propager `sessionId` jusqu'au backend permet de retrouver côté serveur (Sentry/logger) la même session.

**À câbler** :

- `socketClient.ts` : injecter `sessionId` dans `auth: cb => cb({ token, sessionId })` et logguer chaque transition (`connect`, `disconnect` + `reason`, `connect_error` + message rédigé, `reconnect_attempt`, `reconnect`).
- `apiClient` : intercepteur ajoutant l'en-tête `X-Session-Id` (corrélation REST ↔ serveur).
- `roomAudioService.ts` : logguer avec `roomId` (voir §2.2).

### 1.4 Redaction PII (obligatoire — cohérent RGPD)

| Donnée                             | Politique de log                                                        |
| ---------------------------------- | ----------------------------------------------------------------------- |
| Token / accessToken / refreshToken | **JAMAIS** (ni longueur, ni préfixe)                                    |
| OTP                                | **JAMAIS**                                                              |
| Numéro de téléphone                | **JAMAIS** (auth phone)                                                 |
| Vrai nom / displayName             | **JAMAIS** en prod ; clair en overlay QA local seulement                |
| Contenu message / contenu vocal    | **JAMAIS** ; logguer seulement `messageId` + longueur + type            |
| `userId`                           | hashé/raccourci par défaut                                              |
| URL signée LiveKit                 | logguer l'**hôte** seulement, pas le query string (le token est dedans) |

Implémenter une fonction `redact(ctx)` appelée par le logger avant toute sortie ; valeur de PII remplacée par `"[redacted]"`. Le reporter Sentry restant gaté par `consentEnabled` (déjà le cas dans `reporter.ts`), aucune trace ne sort sans opt-in.

### 1.5 Activation / niveau

- Variable d'env / flag : `LOG_LEVEL` (défaut `warn` en prod, `info` en dev) + bascule runtime via l'overlay QA (§4).
- En build store : `debug` strictement impossible (compilé out ou ignoré).

---

## 2. Traces temps-réel — journaliser le cycle de vie

### 2.1 WebSocket (Socket.IO)

Le cycle est déjà piloté dans `socketClient.ts` / `socketStore.ts` mais **non journalisé**. Ajouter un log à chaque transition :

| Événement           | À logguer                                                                                            | `ev`                   |
| ------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------- |
| `connect`           | transport effectif (`polling`→`websocket`), `attempt`, durée depuis `connecting`                     | `ws:connect`           |
| `disconnect`        | `reason` brut socket.io (`io client disconnect` = volontaire, vs `transport close`, `ping timeout`…) | `ws:disconnect`        |
| `connect_error`     | message **rédigé** (juste `auth` / `network` / autre), pas le détail                                 | `ws:connect_error`     |
| `reconnect_attempt` | numéro de tentative, délai courant (1 000→10 000 ms)                                                 | `ws:reconnect_attempt` |
| `reconnect`         | nb total de tentatives consommées                                                                    | `ws:reconnect`         |
| Ping RTT            | résultat de `measureRtt()` (ms ou `null` = timeout)                                                  | `ws:rtt`               |

> **Latence ping** : appeler `measureRtt()` périodiquement pendant une session de test (ex. toutes les 10 s via l'overlay QA) et tracer la série. Un RTT qui grimpe avant un `disconnect` = lien qui se dégrade (corrèle avec profils P8/P9/P10 de `04-plan-reseau.md`).

### 2.2 Événements LiveKit

Dans `roomAudioService.ts`, les handlers existent déjà (`handleConnectionStateChanged`, `handleParticipantConnected/Disconnected`, `handleActiveSpeakersChanged`, `handleReconnecting/Reconnected/Disconnected`) mais sont silencieux. Ajouter un log (niveau `info`/`warn`) :

| Événement LiveKit                                              | À logguer                                                                       | `ev`                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| Connexion établie                                              | url **hôte** seul, `canPublish`                                                 | `lk:connected`                                 |
| `ParticipantConnected` / `Disconnected`                        | `peer#n` (userId rédigé)                                                        | `lk:participant_join` / `lk:participant_leave` |
| Track publiée / souscrite                                      | type (`audio`), source, `peer#n`                                                | `lk:track_published` / `lk:track_subscribed`   |
| Mute / unmute (local + forcé par host via `room:mute-changed`) | `muted`, origine (self / forced)                                                | `lk:mute`                                      |
| `ActiveSpeakersChanged`                                        | nb de speakers, **pas** le niveau brut en continu (échantillonner, sinon flood) | `lk:speakers` (debug)                          |
| Qualité réseau (`ConnectionQuality` LiveKit si exposé)         | `excellent/good/poor`, `peer#n`                                                 | `lk:net_quality`                               |
| `ConnectionStateChanged` → `reconnecting`                      | statut, `rejoinAttempt`, `backoffMs`                                            | `lk:reconnecting`                              |
| `failed` → rejoin manuel                                       | `rejoinAttempt`/`MAX_REJOIN_ATTEMPTS` (5), `backoffMs`                          | `lk:rejoin`                                    |
| Renouvellement token                                           | déclenché, succès/échec (sans le token)                                         | `lk:token_renew`                               |
| SDK natif absent (`LIVEKIT_UNAVAILABLE_SENTINEL`)              | statut `unsupported` (Expo Go / build sans WebRTC)                              | `lk:unsupported`                               |

### 2.3 File d'actions en attente (offline / dégradé)

Tracer ce qui est **mis en file ou rejoué** quand le réseau flanche, pour expliquer les comportements « rien ne se passe » puis « tout part d'un coup » :

- **Refresh auth en vol** (`refreshingAuth` dans `socketClient.ts`) : logguer début/fin et si le reconnect a suivi.
- **React Query** : invalidations et mutations optimistes + rollback (clés `roomKeys`, `messageKeys`, `groupKeys`, `notifications`, `houseKeys`, `adminKeys`). Logguer `ev:'rq:invalidate'` / `'rq:mutation_rollback'` avec la clé.
- **File de mains room** (`useRoomSocket`) : émission « lever la main » bufferisée si socket down, puis rejouée à la reconnexion.
- **Messages sortants** : un message tapé hors-ligne — logguer `ev:'chat:queued'` puis `ev:'chat:flushed'` (avec `messageId`, jamais le contenu).

> Chaque entrée de file doit porter le `sessionId` + `roomId`/`conversationId` pour qu'on voie, dans le log, **l'ordre exact** d'envoi vs réception.

---

## 3. Métriques temps-réel à exposer / observer

### 3.1 Côté backend (`/metrics`, préfixe `chathouse_*`)

Existant : `chathouse_ws_connections` (gauge), `chathouse_http_request_duration_seconds`. **À ajouter** (toutes labellisées, faible cardinalité) :

| Métrique proposée                             | Type    | Labels                                                                                          | Lecture / objectif                                                |
| --------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `chathouse_room_participants`                 | Gauge   | `room_id` (⚠️ borné — seulement rooms de test, sinon explose la cardinalité) ou agrégat `state` | Participants par room ; corrèle au compteur `participantCount` UI |
| `chathouse_room_active_total`                 | Gauge   | —                                                                                               | Nb de rooms live actives                                          |
| `chathouse_ws_messages_total`                 | Counter | `event` (`room:*`, `chat:*`, `notification:*`…)                                                 | **Messages/s** = delta du counter / Δt (méthode diag par delta)   |
| `chathouse_ws_reconnections_total`            | Counter | —                                                                                               | **Taux de reconnexion** = delta / Δt ; pic = instabilité          |
| `chathouse_ws_connect_errors_total`           | Counter | `kind` (`auth`/`network`)                                                                       | Échecs de handshake                                               |
| `chathouse_livekit_token_issued_total`        | Counter | `can_publish`                                                                                   | Jetons audio émis (join + renouvellement + role change)           |
| `chathouse_push_sent_total` / `_failed_total` | Counter | `type` (room_invite, hand_accepted, wave…)                                                      | Fiabilité push                                                    |

> **Diag par delta (rappel)** : `GET /metrics` à T0, action de test, `GET /metrics` à T1, soustraire la valeur du counter visé. Donne **messages/s, reconnexions, erreurs** sans outillage. Documenter dans chaque rapport de bug les valeurs T0/T1 du compteur pertinent (voir checklist §6).

### 3.2 Côté app (à émettre dans les logs, agrégeables hors-ligne)

| Indicateur                        | Source app                     | Comment l'obtenir                                                                                                                                    |
| --------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Latence E2E audio**             | LiveKit                        | RTT/jitter exposés par le SDK (stats WebRTC) ; à défaut, mesure manuelle « top sonore » (A claque → B note le délai perçu) consignée dans le rapport |
| **Drop rate audio**               | LiveKit stats (`packetsLost`)  | échantillonner via overlay QA toutes les N s, logguer `ev:'lk:stats'`                                                                                |
| **Latence signalisation**         | `measureRtt()`                 | série temporelle (§2.1)                                                                                                                              |
| **Délai d'apparition d'un event** | logs corrélés                  | Δt entre `ws:emit` (device A) et réception (device B), via `sessionId`+`roomId`                                                                      |
| **Temps de reconnexion**          | `socketStore.lastTransitionAt` | Δt entre `disconnected` et `connected`                                                                                                               |

### 3.3 Seuils d'alerte indicatifs (pour qualifier OK/KO en test)

| Indicateur                       | OK       | À surveiller | KO                                       |
| -------------------------------- | -------- | ------------ | ---------------------------------------- |
| RTT signalisation (`measureRtt`) | < 150 ms | 150–800 ms   | `null` (timeout) répété                  |
| Latence E2E audio perçue         | < 300 ms | 300–800 ms   | > 800 ms / coupures                      |
| Drop rate audio                  | < 2 %    | 2–5 %        | > 5 % (voix hachée)                      |
| Reconnexions sur 5 min           | 0–1      | 2–3          | rejoin LiveKit qui atteint 5/5 (abandon) |

---

## 4. Overlay / debug menu QA

Ajouter un **overlay flottant** activable seulement sur dev-client / EAS interne (jamais en build store), p.ex. via 3 taps sur le logo ou un flag `__DEV_OVERLAY__`. Composant suggéré : `src/core/observability/DebugOverlay.tsx`, monté dans `App.tsx` derrière une garde d'environnement.

Contenu (lecture seule + quelques bascules) :

- **État connexion** : statut socket (`socketStore`), `lastTransitionAt`, RTT live (`measureRtt`), statut audio (`useRoomAudio`), `rejoinAttempt` courant.
- **Identité de session** : `sessionId` (copiable d'un tap — à coller dans le rapport de bug), `roomId` courant, rôle effectif (guest/standard/admin et HOST/MODERATOR/SPEAKER/LISTENER dans la room).
- **Feature flags** : `REALTIME_ENABLED`, `LIVEKIT_URL` présent ?, `ENV`, build (Expo Go vs dev-client → audio `unsupported`), consentement Sentry on/off.
- **Bascules** :
  - `LOG_LEVEL` (warn ↔ info ↔ debug) en runtime.
  - **Profil réseau** : déclencheur pour appliquer un profil P1…P12 (`04-plan-reseau.md`) — soit en pilotant un throttle local, soit en affichant un rappel des paramètres à régler sur l'outil externe (Network Link Conditioner iOS / `tc`/Charles / mode avion). À défaut d'API in-app, l'overlay sert de **mémo + bouton "marquer coupure à T="** qui pose un log `ev:'qa:net_toggle'` horodaté pour aligner avec la coupure réelle.
  - **Forcer un re-ping RTT**, **forcer un rejoin LiveKit**, **copier le dernier bloc de logs**.

> L'overlay ne doit afficher en clair les PII (vrai nom, userId, numéro) **que** sur build de test interne. Sur tout build distribué, masquer.

---

## 5. Collecte côté test — outils et raccordement bug ↔ trace

### 5.1 Android

```bash
# Logs app filtrés sur le tag JSON (adapter au tag réel du logger RN, souvent "ReactNativeJS")
adb logcat -v time ReactNativeJS:V *:S | findstr "\"ev\":"
# Tout, horodaté, dans un fichier daté
adb logcat -v threadtime > qa_logcat_<bug-id>_<date>.txt
# Forwards / état réseau du device
adb reverse --list
```

> Rappel parc : sur device USB, « Connexion perdue / Impossible de charger les rooms » peut venir d'un `adb reverse` qui établit la connexion mais ne transmet pas les données (câble/port USB) — changer câble + port USB-2 direct avant de conclure à un bug app (voir mémoire projet USB).

### 5.2 iOS

```bash
# Console système du device branché (filtrer sur le process de l'app)
idevicesyslog -p ChatHouse > qa_idevicesyslog_<bug-id>_<date>.txt
# Ou Console.app macOS → filtrer par device + process.
```

### 5.3 Réseau / API

- **Capture HAR** : Charles Proxy / Proxyman (REST + handshake polling socket.io). Exporter le `.har`, **scrubber les tokens** (Authorization, `?access_token=…`, URL signée LiveKit) avant de joindre.
- **WebSocket** : Charles montre les frames WS après upgrade ; les frames LiveKit (média) sont chiffrées/SRTP → s'appuyer sur les **logs LiveKit** (§2.2) et stats WebRTC plutôt que la capture.

### 5.4 Outils RN

- **Reactotron** ou **Flipper** : timeline des logs structurés (§1), du state Zustand (`socketStore`, `currentRoomStore`), des requêtes Axios et des invalidations React Query. Brancher le logger pour qu'il pousse aussi vers Reactotron en dev.

### 5.5 Sentry

- **Breadcrumbs** : tout `info+`/`warn+` du logger (§1.1) alimente la timeline ; un crash arrive avec le fil des events RT qui précèdent. Sentry reste **gaté par consentement** (`reporter.ts`) — pour les builds QA internes, activer le consentement explicitement.
- **Backend** : exceptions serveur + `morgan`/`logger` corrélables par `X-Session-Id` (§1.3).

### 5.6 Comment relier un bug à une trace

1. Le `sessionId` (copié depuis l'overlay §4) est la **clé maîtresse** : il figure dans les logs app, l'en-tête `X-Session-Id` des requêtes, et donc dans les logs/Sentry backend.
2. Le `roomId` aligne les timelines des **2 devices** d'un scénario `03-scenarios-temps-reel.md`.
3. L'horodatage `t` (ISO ms) + `lastTransitionAt` permet de poser Δt précis (latence event, durée de reconnexion).
4. Les valeurs T0/T1 de `/metrics` (diag par delta) chiffrent l'impact côté serveur (reconnexions, messages, erreurs).

---

## 6. Checklist — avant de déclarer un bug temps-réel

Un ticket « bug RT » n'est **recevable** que si les éléments suivants sont joints (sinon : non reproductible → à compléter).

### 6.1 Contexte (toujours)

- [ ] **Build** : Expo Go ou **dev-client EAS** ? (l'audio est `unsupported` en Expo Go — banniere normale, pas un bug).
- [ ] **Plateforme + OS** : Android/iOS + version, modèle device.
- [ ] **Profil réseau** : P1…P12 (`04-plan-reseau.md`) et **moment exact de la coupure** si applicable.
- [ ] **Rôle(s)** : guest/standard/admin et rôle room (HOST/MODERATOR/SPEAKER/LISTENER) de chaque acteur.
- [ ] **Scénario** : id `RT-NNN` / `NET-NNN` / cas écran concerné + nb d'acteurs/devices.
- [ ] **`sessionId`** de chaque device impliqué (copié depuis l'overlay §4).
- [ ] **`roomId`** / `conversationId` concerné.

### 6.2 Traces à joindre (selon la nature du bug)

| Type de bug                                              | Traces obligatoires                                                                                                                                       |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Audio** (pas de son, voix hachée, mute KO)             | logs `lk:*` des 2 devices, statut `useRoomAudio` au moment du KO, `rejoinAttempt`, stats drop/RTT si dispo (overlay), profil réseau                       |
| **Socket / sync** (event non reçu, file de mains, badge) | logs `ws:*` des 2 devices (émission + réception), `ev:'rq:invalidate'`, statut `socketStore` + `lastTransitionAt`, T0/T1 de `chathouse_ws_messages_total` |
| **Reconnexion**                                          | logs `ws:disconnect`(reason)→`ws:reconnect`, série `measureRtt`, Δt reconnexion, T0/T1 `chathouse_ws_reconnections_total`                                 |
| **Auth / handshake**                                     | log `ws:connect_error`(kind rédigé), trace du refresh (`refreshingAuth`), HAR scrubé du replay 401→refresh→retry                                          |
| **Push**                                                 | type de notif, app au premier plan/arrière-plan/tuée, T0/T1 `chathouse_push_*_total`, logcat/idevicesyslog                                                |

### 6.3 Hygiène

- [ ] Tokens / OTP / numéros / vrais noms / contenu de message **scrubés** des HAR et captures.
- [ ] Δt mesurés (apparition event, reconnexion) plutôt que « ça lague ».
- [ ] Reproduit ≥ 2 fois OU une seule fois mais avec trace + `sessionId` complets.
- [ ] Comportement attendu sourcé (i18n `fr.json`/`en.json` pour les messages, constantes `04-plan-reseau.md` pour les timeouts/backoff).

---

## 7. Récapitulatif — quoi implémenter, par priorité

| Prio   | Action                                                                                     | Fichier(s)                                                     |
| ------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| **P0** | Logger JSON unique + redaction PII + niveaux                                               | `src/core/observability/logger.ts` (nouveau)                   |
| **P0** | `sessionId` propagé (logs + `X-Session-Id` Axios + handshake socket)                       | `socketClient.ts`, `apiClient`                                 |
| **P0** | Journaliser cycle WS + LiveKit (§2.1, §2.2)                                                | `socketClient.ts`, `roomAudioService.ts`                       |
| **P1** | Métriques RT backend (`ws_messages_total`, `ws_reconnections_total`, `room_participants`…) | `backend/src/monitoring/metrics.ts` + sites d'émission socket  |
| **P1** | Overlay QA (état connexion/rôle/flags + bascule LOG_LEVEL/réseau + copie sessionId)        | `src/core/observability/DebugOverlay.tsx` (nouveau), `App.tsx` |
| **P2** | Échantillonnage stats WebRTC LiveKit (drop/RTT/jitter) → log `lk:stats`                    | `roomAudioService.ts` / `LiveKitEngine.ts`                     |
| **P2** | Branchement logger → Reactotron/Flipper (dev) et breadcrumbs Sentry (QA interne)           | `logger.ts`, `reporter.ts`                                     |
