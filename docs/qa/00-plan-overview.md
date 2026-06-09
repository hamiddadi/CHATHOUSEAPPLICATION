# Plan de test global — ChatHouse

> Application audio live facon Clubhouse — React Native / Expo (SDK 55), temps reel WebSocket (`socket.io-client`) + audio **LiveKit** (`@livekit/react-native`), push (`expo-notifications`), i18n FR/EN, roles guest / standard / admin, Android + iOS.
>
> **Perimetre teste** : 50 ecrans · 381 boutons/interactions · 991 cas de test deja rediges (un fichier par ecran sous `docs/qa/screens/01-…` a `50-…`).
> **Document maitre** : ce fichier est le plan de reference. Chaque ecran possede sa propre matrice de boutons + cas dans `docs/qa/screens/`.

| Champ                        | Valeur                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| Version cible                | app `0.1.0` (`package.json`)                                                       |
| Branche                      | `feat/clubhouse-identity-virality`                                                 |
| Backend de test              | API locale `:4000` (REST + WebSocket), Postgres + Redis (docker)                   |
| Canaux de build (`eas.json`) | `development` (dev-client), `preview` (interne APK / simulateur iOS), `production` |
| Domaines de deep-link        | `chathouse://`, `https://app.chathouse.com`, schema Expo                           |
| Date                         | 2026-06-09                                                                         |

---

## 1. Objectifs & perimetre

### 1.1 Objectif

Garantir que **chacun des 50 ecrans** de ChatHouse, **chacun de leurs 381 boutons/interactions** et **chacun des 991 cas de test** se comportent conformement a la specification : sur **Android et iOS**, **OS recents et anciens**, **reseaux variables** (3G / 4G / 5G / Wi-Fi avec pertes, latence, reconnexion), pour les **trois familles de roles** (guest, standard, admin) et leurs **roles derives en room** (listener / speaker / moderator / host).

### 1.2 Perimetre fonctionnel (14 domaines, 50 ecrans)

Couverture pilotee par les 14 features du code (`src/features/*`) :

| Feature         | Ecrans couverts (fichiers `docs/qa/screens/`)                                       |
| --------------- | ----------------------------------------------------------------------------------- |
| `admin`         | 01-ADM-AUDIT, 02-ADM-HOME, 03-ADM-REP, 04-ADM-ROOMS, 05-ADM-UDET, 06-ADM-USERS      |
| `auth`          | 07-AUTH-LAND, 08-AUTH-NAME, 09-AUTH-OTP, 10-AUTH-PHONE, 11-AUTH-UNAME, 12-AUTH-WAIT |
| `events`        | 13-EVT                                                                              |
| `extensions`    | 14-EXT-FEED, 15-EXT-PLAY, 16-EXT-SET, 17-EXT-FOLLOW, 18-EXT-TOPIC                   |
| `houses`        | 19-HOUSE-CREATE, 20-HOUSE-DETAIL, 21-HOUSE-INVITE, 22-HOUSE-LIST, 23-HOUSE-MEMBER   |
| `maps`          | 24-MAP                                                                              |
| `messages`      | 25-MSG-ADDGRP, 26-MSG-CHAT, 27-MSG-GCHAT, 28-MSG-GINFO, 29-MSG-LIST, 30-MSG-NEW     |
| `notifications` | 31-NOTIF                                                                            |
| `onboarding`    | 32-ONB-INT, 33-ONB-PERM, 34-ONB-SETUP, 35-ONB-WELCOME                               |
| `privacy`       | 36-PRIV-EXPORT, 37-PRIV-DELETE, 38-PRIV-POLICY, 39-PRIV-TERMS                       |
| `profile`       | 40-PROF-EDIT, 41-PROF-FOLLOWERS, 42-PROF-VIEW                                       |
| `rooms`         | 43-ROOM-CREATE, 44-ROOM-INVITE, 45-ROOM-REPLAY, 46-ROOM-FEED, 47-ROOM-LIVE          |
| `search`        | 48-SEARCH                                                                           |
| `settings`      | 49-SET-NOTIF, 50-SET-MAIN                                                           |

### 1.3 Axes de test couverts pour chaque bouton

Pour **chaque** interaction de la matrice de bouton, le perimetre couvre quatre axes (deja reflete dans les fichiers ecran) :

1. **Fonctionnel positif** — l'action aboutit (navigation, mutation REST, emission socket).
2. **Erreur / limite** — multi-clic rapide, hors-ligne, latence/timeout, rollback optimiste, etat vide, bornes (caps, throttles).
3. **Accessibilite** — lecteur d'ecran (TalkBack / VoiceOver), police agrandie (jusqu'a XXL), fort contraste, cibles >= 44x44, `accessibilityState` (selected/disabled).
4. **Temps reel multi-utilisateur** (ecrans concernes : rooms, messages, notifications, houses, admin) — synchronisation entre 2-3 devices via WebSocket, filtrage de l'echo propre, reconnexion.

### 1.4 Plateformes

- **Android** 10 -> 15 ; **iOS** 15 -> 18 ; gamme **low-end** et **high-end** (voir matrice §6).
- Couverture deep-link / liens partages (`room/:roomId`, `house/:houseId/invite/:inviteToken?`, `invite/<code>` referral, `chat/:conversationId`, etc. — cf. `src/core/navigation/linking.ts`).

---

## 2. Hors-perimetre

| Hors-perimetre                                                                     | Raison                                                                                                                                                                      |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tests unitaires de la qualite serveur / API backend en isolation                   | Couverts par la suite backend (jest) du depot API ; ici seul le **contrat** REST/WS observe cote app est verifie.                                                           |
| Charge / stress / capacite serveur (montee a N milliers d'utilisateurs simultanes) | Releve d'un plan de perf dedie, non du test fonctionnel d'app.                                                                                                              |
| Penetration / audit de securite offensif                                           | Couvert par l'audit securite dedie (le plan QA verifie seulement les garde-fous cote client : sanitisation deep-link, jamais de log de token d'invitation, gating de role). |
| Voix reelle LiveKit **sous Expo Go**                                               | Impossible : module natif absent => l'app affiche la banniere `unsupported`. La voix se teste **uniquement sur build EAS dev-client / preview** (voir §5).                  |
| Le bouton **dev-skip** du Landing (`onDevSkip`) en build de production finale      | Marque "DO NOT COMMIT" : il doit avoir disparu en prod ; on verifie son **absence** en prod, pas son fonctionnement.                                                        |
| Tests web (`expo start --web`)                                                     | Cible produit = mobile Android/iOS ; le web n'est pas une plateforme livree.                                                                                                |
| Localisations autres que FR / EN                                                   | Seules deux locales sont chargees.                                                                                                                                          |
| Personnalisation OEM extreme (skins constructeur exotiques, ROM custom)            | Hors parc cible ; on teste le parc constructeur courant (§6).                                                                                                               |

---

## 3. Approche

### 3.1 Manuel + automatise

| Niveau (pyramide)                   | Outil / support                                                                                                                                | Couverture                                                                                                 | Frequence                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Unitaire / composant**            | Jest (`jest`, `jest-expo`) + `@testing-library/react-native`, harness `jest-setup.ts` + `src/test-utils/renderScreen.tsx` + mocks `__mocks__/` | 50 ecrans rendus, props/etats, logique de boutons, branches de role, etats vides/erreur                    | A chaque commit / CI (`npm test`, `npm run test:ci`) |
| **Integration (front)**             | Jest + React Query mocke + sockets mockes                                                                                                      | Flux multi-ecrans (auth -> onboarding -> main), invalidations de cache, navigation                         | A chaque PR                                          |
| **Manuel exploratoire & scenarios** | Cas `docs/qa/screens/*.md` joues a la main sur device reel                                                                                     | Temps reel multi-device, audio LiveKit, permissions OS, reseaux instables, accessibilite (lecteur d'ecran) | Par campagne (avant release)                         |
| **End-to-end device**               | Build EAS dev-client / preview sur device physique + backend `:4000`                                                                           | Parcours complets bout-en-bout, push, deep-links, partage natif                                            | Avant chaque livraison                               |

> **Contrainte d'execution Jest (PC de dev ~1 Go libre)** : lancer les suites **feature par feature** en `--runInBand` (`npx jest <feature> --runInBand`), pas tout en parallele (risque OOM). Reference : 54 suites / 314 tests verts au dernier passage du harness ecran.

### 3.2 Priorisation (P0 / P1 / P2)

Reprise de la priorite portee par chaque cas dans les fichiers ecran :

- **P0** — chemin critique : audio (mute/unmute, force-mute, reconnexion), entrer/quitter/fermer une room, lever la main, promotion/retrogradation, kick, auth (OTP, login). Bloquant pour la release.
- **P1** — fonctionnalites importantes : partage, invitations, chat de room, moderation, navigation principale, export RGPD.
- **P2** — confort / secondaire : animations, sections vides decoratives, libelles, bascule de langue.

Regle de campagne : **100 % des P0 + P1** rejoues sur la matrice d'appareils minimale avant livraison ; **P2** sur au moins un device de reference par OS.

---

## 4. Risques majeurs & mitigations

| #   | Risque                                                                                                                                                                                          | Impact                                                                      | Mitigation                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Temps reel (WebSocket)** : evenements manques, doublons, desync entre devices (`room:role_changed`, `room:ended`, `room:user_kicked`, `room:mute-changed`, `room:reaction`, messages, notifs) | Etat d'ecran incoherent, deux verites concurrentes (UI vs store vs serveur) | Cas multi-utilisateur a 2-3 devices systematiques sur rooms/messages/notifs ; verifier le **filtrage de l'echo propre** (`userId === viewerId`) et le **resnap sur verite serveur** (`serverHandRaised`, `currentRoomStore`).                                                                               |
| R2  | **Reseau instable** (3G/4G/5G/Wi-Fi, pertes, latence, mode avion)                                                                                                                               | Mutations optimistes non rollback, ecrans figes, doubles appels             | Pour chaque bouton mutateur : scenario hors-ligne + latence + multi-clic ; verifier **rollback optimiste complet** (UI + store + LiveKit) et que les ecrans de sortie (Quitter / Fermer room) **partent quand meme** en `onSettled` malgre l'echec REST. Outils : mode avion, bridage 3G, coupure mid-call. |
| R3  | **Audio LiveKit natif** : module absent (Expo Go), permission micro refusee, hot-unmute apres reconnexion, statuts `connecting`/`reconnecting`/`error`/`unsupported`                            | Voix muette, fuite de mute, banniere erronee                                | Tester **uniquement sur build EAS** ; verifier la banniere `unsupported` sous Expo Go (app reste fonctionnelle sans voix) ; verifier que le mute **survit au reconnect** (restaure depuis `currentRoomStore`, pas de hot-unmute) ; tester permission micro refusee/revoquee.                                |
| R4  | **Race conditions** : multi-clic rapide (double navigation, double mutation), throttle de reactions, caps de rendu                                                                              | Piles de navigation dupliquees, spam de POST, arbre Reanimated illimite     | Scenario "tap x4/x5 tres vite" sur **chaque** bouton ; verifier guards (`devSkipPending`, `disabled`), throttle reactions `TAP_THROTTLE_MS` (250 ms), `MAX_FLOATS` (24), `OTHERS_DISPLAY_CAP` (50).                                                                                                         |
| R5  | **Permissions OS** : micro, notifications, localisation (maps), camera/galerie (photo de profil) — accordee, refusee, revoquee a chaud                                                          | Crash ou ecran bloque selon l'etat de permission                            | Matrice de permission par ecran concerne (room=micro, onboarding/notif=push, maps=localisation, edit profil=camera/galerie) ; tester accord, refus, revocation a chaud, "ne plus demander".                                                                                                                 |
| R6  | **Fragmentation OS** : Android 10->15 (comportements de fond, runtime permissions, gestes), iOS 15->18, encoches/Dynamic Island, densites d'ecran                                               | Layout casse, comportement de reconnexion socket variable en arriere-plan   | Matrice d'appareils §6 ; verifier safe-areas (`react-native-safe-area-context`), comportement app en arriere-plan (socket + audio), restauration au foreground.                                                                                                                                             |
| R7  | **Crash natif au boot** (historique : `expo-asset@56` tire par `expo-audio` en projet SDK 55)                                                                                                   | Ecran noir au demarrage                                                     | Smoke "cold start" sur chaque OS de la matrice apres chaque build ; `overrides` `expo-asset ~55.0.17` verrouille ; surveiller Sentry au boot.                                                                                                                                                               |
| R8  | **Build OOM / mono-ABI** (build local 8 Go -> arm64-v8a seul)                                                                                                                                   | APK qui ne s'installe pas sur device 32-bit                                 | Documenter la cible ABI du build de test ; valider l'install sur les devices reels de la matrice avant campagne.                                                                                                                                                                                            |
| R9  | **Connexion front <-> API** : `.env` racine = IP LAN du PC (perime au changement de reseau), USB reverse data-flow defaillant                                                                   | "Connexion perdue / Impossible de charger les rooms" — faux negatif de test | Pre-check d'environnement avant campagne (ping `:4000`, delta compteur `/metrics`) ; redemarrer Expo apres edition `.env` ; cable + port USB-2 direct si device USB.                                                                                                                                        |
| R10 | **i18n FR/EN** : cle brute affichee, troncature en police XXL, label a11y non traduit                                                                                                           | Texte casse, accessibilite degradee                                         | Bascule FR/EN sur chaque ecran (cas type "Bascule de langue") ; verifier libelles **et** `accessibilityLabel`.                                                                                                                                                                                              |
| R11 | **Gating de role** : un ecran/bouton admin ou de moderation expose a un role insuffisant                                                                                                        | Escalade de privilege cote UI                                               | Tester chaque ecran avec un role **insuffisant** : `appRole` USER ne voit pas l'admin ; `ADMIN` vs `SUPER_ADMIN` (audit log = SUPER_ADMIN, force-end room = ADMIN) ; listener ne voit pas les controles host/mod.                                                                                           |
| R12 | **Push notifications** : reception app fermee / arriere-plan / premier-plan, deep-link depuis la notif                                                                                          | Notif perdue ou navigation erronee                                          | Tester les 3 etats d'app + tap-vers-deep-link ; verifier `pushService.registerWithBackend()` best-effort sans crash si echec.                                                                                                                                                                               |

---

## 5. Dependances

### 5.1 Comptes de test

| Compte        | `appRole`         | Usage                                                                                                           |
| ------------- | ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `guest`       | (non authentifie) | Landing, CTA, deep-links pre-auth, room en auditeur non connecte.                                               |
| `standard`    | `USER`            | Parcours nominal : feed, room (listener/speaker/host de ses propres rooms), messages, profil, houses, settings. |
| `moderator`   | `MODERATOR`       | Moderation de room (sans acces admin global).                                                                   |
| `admin`       | `ADMIN`           | Console admin, force-end room, gestion users/reports.                                                           |
| `super_admin` | `SUPER_ADMIN`     | Audit log (gate `isAtLeast(role, 'SUPER_ADMIN')`), actions privilegiees.                                        |
| `devuser`     | `USER`            | Dev-skip du Landing (build dev/preview uniquement).                                                             |

> Pour les scenarios temps reel il faut **plusieurs comptes simultanes** (ex. ROOM-LIVE multi-utilisateur : 1 host + 2 auditeurs sur 3 devices).

### 5.2 Base de test — etats de donnees requis

L'API `:4000` doit etre seedee avec, au minimum :

- **Conversations vides** ET conversations avec historique (1:1 et groupes) — pour MSG-LIST / MSG-CHAT / MSG-GCHAT.
- **Notifications non lues** ET liste vide — pour NOTIF (badge, marquage lu).
- **Room live active** avec : host, plusieurs speakers, file de mains levees, > 50 auditeurs (test cap "+N"), au moins un auditeur **suivi** par le viewer.
- **Room terminee / inexistante** — pour l'`EmptyState` "Room indisponible".
- **Houses** : avec membres, avec invitation en attente, invitation signee HMAC valide ET expiree/invalide (deep-link `house/:houseId/invite/:inviteToken?`).
- **Profils** : self vs autrui, suivi / non suivi, compteurs followers/following, profil suspendu (vue admin).
- **Reports** ouverts ET resolus ; **audit log** non vide ; **rooms admin** live et terminees.
- **Replays** disponibles et liste vide.
- **Code d'invitation referral** valide (`invite/<code>` = base64url.sig) + quota atteint.
- **Events** a venir / passes / liste vide.

### 5.3 Builds & infrastructure

- **Build EAS dev-client** (canal `development`, `REALTIME_ENABLED=true`) — **requis** pour tester la voix LiveKit et les modules natifs (WebRTC). Expo Go ne suffit pas.
- **Build EAS preview** (APK Android interne / simulateur iOS) pour la campagne avant release.
- Backend `:4000` joignable depuis le device (IP LAN a jour dans `.env` racine, ou `adb reverse` avec cable/port fiable).
- **Sentry** actif (surveillance crash au boot, R7) ; endpoint `/metrics` pour diagnostiquer le data-flow (R9).
- **Outils reseau** : bridage 3G/4G/5G, mode avion, coupure mid-call (proxy ou reglages OS).
- **Lecteurs d'ecran** : TalkBack (Android), VoiceOver (iOS) ; reglages police XXL + fort contraste.

---

## 6. Environnements & matrice d'appareils

### 6.1 Environnements logiques

| Env                   | Backend                                         | Build          | Usage                                                      |
| --------------------- | ----------------------------------------------- | -------------- | ---------------------------------------------------------- |
| **Local dev**         | API `:4000` (docker pg+redis, `prisma db push`) | dev-client     | Debug, tests unitaires/integration, mise au point des cas. |
| **Staging / preview** | API staging (`APP_ENV=staging`)                 | EAS preview    | Campagne de pre-release sur device reel.                   |
| **Production**        | API prod (`APP_ENV=production`)                 | EAS production | Smoke post-release uniquement (sans dev-skip).             |

### 6.2 Matrice d'appareils (cible)

| Plateforme | Version OS | Tier     | Exemples de reference               | Couverture attendue     |
| ---------- | ---------- | -------- | ----------------------------------- | ----------------------- |
| Android    | **10**     | low-end  | appareil entree de gamme 2-3 Go RAM | P0 + P1                 |
| Android    | **12**     | mid      | mid-range courant                   | P0 + P1 + P2            |
| Android    | **14**     | high-end | Pixel / Samsung recent              | Tous                    |
| Android    | **15**     | high-end | dernier OS                          | P0 + P1 (regression OS) |
| iOS        | **15**     | low-end  | iPhone SE 1re-2e gen / iPhone 8     | P0 + P1                 |
| iOS        | **16/17**  | mid      | iPhone 12/13                        | P0 + P1 + P2            |
| iOS        | **18**     | high-end | iPhone 15/16 (Dynamic Island)       | Tous                    |

> **Combinatoire minimale par campagne** : au moins **1 low-end** et **1 high-end** par OS (Android + iOS), couvrant les bornes OS (Android 10 & 15, iOS 15 & 18). Note ABI : si le build de test est mono-ABI arm64-v8a (R8), exclure / re-builder pour les devices 32-bit.

### 6.3 Conditions reseau a couvrir

Wi-Fi stable · 4G/5G · **3G bride** (latence elevee) · **mode avion / hors-ligne** · **coupure en cours d'appel** (perte WebSocket + LiveKit puis reconnexion) · bascule Wi-Fi <-> cellulaire.

---

## 7. Roles & jeux de donnees

### 7.1 Deux niveaux de role

1. **Role applicatif** (`appRole` : `USER` < `MODERATOR` < `ADMIN` < `SUPER_ADMIN`, cf. `ROLE_RANK`) — gouverne l'acces a la console admin et aux actions privilegiees. Mapping vers le vocabulaire du brief : **guest** = non authentifie, **standard** = `USER`, **admin** = `ADMIN`/`SUPER_ADMIN`.
2. **Role derive en room** (`listener` / `speaker` / `moderator` / `host`) — gouverne micro, moderation, fermeture de room. Independant du role applicatif (un `USER` standard est `host` de sa propre room).

### 7.2 Jeux de donnees par domaine

| Domaine           | Jeux a preparer                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| auth / onboarding | numero valide / invalide ; OTP correct / expire / faux ; username libre / pris ; etat waitlist ; `isNewUser` true/false.       |
| rooms             | room live (host + speakers + mains levees + >50 auditeurs + auditeur suivi) ; room terminee ; reactions ; replay dispo / vide. |
| messages          | conversations 1:1 et groupe avec / sans historique ; conversation vide ; membres de groupe a ajouter.                          |
| houses            | house avec membres ; invitation en attente ; token HMAC valide / expire ; quota d'invitation atteint.                          |
| profile           | self / autrui ; suivi / non suivi ; compteurs ; champs vides vs remplis.                                                       |
| notifications     | non lues / lues / liste vide ; deep-link cible valide / obsolete.                                                              |
| admin             | stats peuplees ; reports ouverts/resolus ; audit log non vide ; users suspendus / actifs / supprimes ; roles varies.           |
| privacy           | export RGPD demande / en cours ; suppression de compte ; textes policy/terms.                                                  |
| search / explore  | resultats non vides / vides ; requete avec / sans match.                                                                       |
| maps              | localisation accordee / refusee ; points a proximite / aucun.                                                                  |
| events            | a venir / passes / liste vide.                                                                                                 |
| extensions        | feed activite, playground, topic explorer, suggested follows (etats vides inclus).                                             |

---

## 8. Criteres d'entree / sortie & "pret a livrer"

### 8.1 Criteres d'entree (avant de lancer une campagne)

- [ ] Build EAS (dev-client ou preview) **installe et boot OK** (smoke cold-start, pas d'ecran noir R7) sur chaque OS de reference.
- [ ] Backend `:4000` (ou staging) joignable + `/metrics` repond ; `.env` / IP LAN a jour (R9).
- [ ] Base de test **seedee** avec tous les etats du §5.2.
- [ ] Comptes guest / standard / moderator / admin / super_admin disponibles et fonctionnels.
- [ ] Suites Jest vertes (`npm run test:ci`) — pas de regression unitaire/composant ouverte.
- [ ] Matrice d'appareils §6 disponible (au moins le minimum par OS).
- [ ] Lecteurs d'ecran + outils de bridage reseau prets.

### 8.2 Criteres de sortie (fin de campagne)

- [ ] **100 % des cas P0 executes** sur la matrice minimale, **0 KO P0** restant.
- [ ] **100 % des cas P1 executes**, anomalies P1 **resolues ou acceptees** (waiver documente).
- [ ] **>= 90 % des cas P2 executes** sur >= 1 device de reference par OS.
- [ ] Aucun **crash** sur les parcours P0/P1 (verifie via Sentry sur la duree de campagne).
- [ ] Aucun **blocage d'accessibilite** P0/P1 (label muet, action non declenchable, troncature bloquante en police XXL).
- [ ] Tous les axes temps reel multi-utilisateur P0 verts (room: mute/role/kick/end, messages, notifs).
- [ ] FR **et** EN verifies sur les ecrans a forte densite de texte (pas de cle brute).
- [ ] Rapport de campagne consolide (taux d'execution, anomalies par priorite, devices couverts).

### 8.3 Definition de "Pret a livrer" (Definition of Done QA)

Une version est **prete a livrer** lorsque :

1. Criteres de sortie §8.2 satisfaits.
2. Bouton **dev-skip absent** du build de production (verifie sur l'APK/IPA de prod).
3. Voix LiveKit validee sur **build natif** (jamais signe sur la base d'Expo Go) ; mute survit a la reconnexion ; banniere `unsupported` correcte la ou attendu.
4. Deep-links critiques (`room/:roomId`, `house/.../invite/...`, referral `invite/<code>`, `chat/:conversationId`) ouvrent la bonne route, **token d'invitation sanitise et jamais logge** (R11/securite).
5. Gating de role verifie : aucun ecran/action admin ou moderation accessible a un role insuffisant.
6. Aucune anomalie **bloquante ou critique** ouverte ; les anomalies mineures restantes sont tracees avec proprietaire et echeance.
7. Sign-off QA Lead consigne dans le rapport de campagne.

---

## 9. Calendrier indicatif & RACI QA

### 9.1 Calendrier indicatif (par campagne de release)

| Phase | Contenu                                                                       | Duree indicative |
| ----- | ----------------------------------------------------------------------------- | ---------------- |
| J0    | Verif criteres d'entree §8.1 (build, backend, seed, devices)                  | 0,5 j            |
| J1    | Smoke cross-OS (boot, navigation racine, auth, 1 parcours room)               | 0,5 j            |
| J1-J3 | Execution P0 sur matrice minimale (auth, rooms/audio, messages, admin gating) | 2 j              |
| J3-J5 | Execution P1 (partage, invitations, houses, moderation, RGPD, notifs/push)    | 2 j              |
| J5-J6 | P2 + accessibilite (lecteur d'ecran, police XXL, contraste) + FR/EN           | 1,5 j            |
| J6    | Tests temps reel multi-device + reseaux instables (regroupes)                 | 1 j              |
| J7    | Retests des correctifs, consolidation, sign-off                               | 0,5-1 j          |

> Volumetrie indicative : 991 cas, durees unitaires 2-6 min/cas dans les fiches ecran. L'automatisation (niveau composant/integration) absorbe les axes fonctionnels et de regression repetitifs ; le **manuel** se concentre sur audio natif, multi-device, permissions OS, reseau instable et accessibilite.

### 9.2 RACI QA

| Activite                                                 | QA Lead | QA Engineer | Dev | Product Owner |
| -------------------------------------------------------- | ------- | ----------- | --- | ------------- |
| Maintien du plan global + fiches ecran                   | A/R     | C           | C   | I             |
| Preparation environnement & seed de test                 | C       | R           | A   | I             |
| Execution cas manuels (P0/P1/P2)                         | A       | R           | I   | I             |
| Maintien des tests automatises (Jest)                    | C       | C           | R/A | I             |
| Tests temps reel multi-device                            | A       | R           | C   | I             |
| Tests accessibilite (lecteur d'ecran, contraste, police) | A       | R           | C   | I             |
| Triage & priorisation des anomalies                      | A/R     | R           | C   | C             |
| Correction des anomalies                                 | I       | I           | R/A | I             |
| Sign-off "Pret a livrer"                                 | A/R     | C           | C   | C/I           |
| Decision de release                                      | I       | I           | C   | A/R           |

> R = Realise · A = Approuve (responsable final) · C = Consulte · I = Informe.

---

### Annexe — references code

- Ecrans : `src/features/<feature>/screens/…`
- Navigation & deep-links : `src/core/navigation/` (`RootNavigator.tsx`, `linking.ts`, `MainNavigator.tsx`, `types.ts`)
- Roles applicatifs : `src/features/admin/types/admin.types.ts` (`AppRole`, `ROLE_RANK`, `isAtLeast`)
- Audio / temps reel : hooks `useRoomAudio`, `useRoomSocket`, store `currentRoomStore` ; `@livekit/react-native`, `socket.io-client`
- Builds : `eas.json` (canaux development / preview / production)
- Harness de test : `jest.config.js`, `jest-setup.ts`, `src/test-utils/renderScreen.tsx`, `__mocks__/`
- Fiches detaillees par ecran : `docs/qa/screens/01-…` a `50-…`
