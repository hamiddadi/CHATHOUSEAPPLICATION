# Plan de test réseau — Conditions dégradées (ChatHouse)

> Application : ChatHouse — audio live façon Clubhouse. React Native / Expo, WebSocket (Socket.IO) temps réel, audio LiveKit (`@livekit/react-native`, build EAS dev-client requis), push, i18n FR/EN, rôles guest/standard/admin, Android + iOS.
> Périmètre testé : 50 écrans, 381 boutons, 991 cas existants. Ce document couvre **uniquement la robustesse réseau** (conditions dégradées, coupures, idempotence, reconnexion).

## 0. Comment utiliser ce document

- Chaque cas porte un identifiant `NET-NNN`, des **pré-conditions**, des **étapes** (avec le **moment exact** de la coupure), un **résultat attendu**, un **critère OK/KO** et une **durée** estimée.
- Les profils réseau (P1…P12) sont définis au §1. Les cas référencent ces profils.
- Tous les messages d'erreur attendus sont sourcés des fichiers i18n réels :
  - FR : `src/core/i18n/locales/fr.json`
  - EN : `src/core/i18n/locales/en.json`
- Les comportements techniques attendus sont sourcés du code réel (références indiquées dans chaque section).

### Constantes techniques de référence (extraites du code)

| Constante                    | Valeur                                                                               | Source                                              |
| ---------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Timeout HTTP global          | **15 000 ms** (`DEFAULT_TIMEOUT_MS`)                                                 | `src/shared/services/api/apiClient.ts`              |
| Timeout upload avatar        | **60 000 ms** (override)                                                             | `src/shared/services/api/mediaService.ts`           |
| Mapping timeout              | `ECONNABORTED` → `kind:'timeout'`                                                    | `src/shared/services/api/errorHandler.ts`           |
| Mapping coupure              | pas de réponse → `kind:'network'`                                                    | `src/shared/services/api/errorHandler.ts`           |
| Refresh 401                  | 1 refresh silencieux + replay ; blip réseau pendant refresh = **pas de déconnexion** | `src/shared/services/api/interceptors.ts`           |
| Socket.IO transports         | `['polling','websocket']` (polling d'abord, upgrade WS)                              | `src/shared/services/realtime/socketClient.ts`      |
| Socket.IO reconnexion        | `reconnection:true`, delay `1 000 ms` → max `10 000 ms`                              | idem                                                |
| Socket.IO auth               | callback re-lit le token frais à chaque (re)connexion                                | idem                                                |
| LiveKit rejoin manuel        | max **5 tentatives**, backoff expo `2 000 ms`→`30 000 ms`                            | `src/features/rooms/services/roomAudioService.ts`   |
| LiveKit renouvellement token | planifié avec ~30 s d'avance avant expiration                                        | idem                                                |
| OTP                          | auto-submit à 6 chiffres ; max **5 tentatives** ; cooldown renvoi **60 s**           | `src/features/auth/screens/OtpScreen/OtpScreen.tsx` |
| OTP backend                  | code **one-shot** (marqué `isUsed` avant émission tokens) ; user **find-or-create**  | `backend/src/modules/otp/otp.service.ts`            |

---

## 1. Matrice des profils réseau et outils

### 1.1 Profils réseau

| ID      | Profil                  | Débit ↓ / ↑         | Latence (RTT) | Perte paquets     | Cible d'usage                   |
| ------- | ----------------------- | ------------------- | ------------- | ----------------- | ------------------------------- |
| **P1**  | Wi-Fi sain              | ≥ 30 Mbps / 10 Mbps | 10–30 ms      | 0 %               | Référence happy-path            |
| **P2**  | 5G                      | 50 Mbps / 20 Mbps   | 20–40 ms      | 0 %               | Mobile premium                  |
| **P3**  | 4G/LTE                  | 10 Mbps / 3 Mbps    | 50–80 ms      | 0–1 %             | Mobile nominal                  |
| **P4**  | 3G                      | 1 Mbps / 384 kbps   | 150–300 ms    | 1–2 %             | Mobile dégradé                  |
| **P5**  | EDGE / 2G               | 240 kbps / 120 kbps | 400–800 ms    | 2–5 %             | Zone rurale / saturé            |
| **P6**  | Perte 5 %               | 4G                  | + base        | **5 %**           | Liens instables                 |
| **P7**  | Perte 20 %              | 4G                  | + base        | **20 %**          | Lien très dégradé               |
| **P8**  | Latence 150 ms          | Wi-Fi               | **150 ms**    | 0 %               | Serveur distant                 |
| **P9**  | Latence 800 ms          | 4G                  | **800 ms**    | 1 %               | Satellite / VPN lointain        |
| **P10** | Latence 2 s             | 3G                  | **2 000 ms**  | 2 %               | Pire cas — proche timeout       |
| **P11** | Bande passante limitée  | 128 kbps symétrique | 200 ms        | 1 %               | Captive portal / hotspot saturé |
| **P12** | Mode avion intermittent | ON/OFF cyclique     | n/a           | 100 % par fenêtre | Tunnel / ascenseur / métro      |

> **P10 (latence 2 s)** est volontairement proche du timeout global de 15 s : une requête lente + retry frôle l'`ECONNABORTED`. C'est le profil clé pour valider que l'app affiche `timeout` (et non `network`) et reste utilisable.

### 1.2 Outils par plateforme

| Besoin                             | Android                                                                                                         | iOS                                                                                                                                    | Cross-platform                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Throttling débit/latence/perte     | **Android Emulator** → Extended controls → Cellular (Network type: GSM/EDGE/3G/LTE/5G) ; ou `adb shell` / proxy | **Network Link Conditioner** (Réglages → Développeur, ou app macOS « Additional Tools ») — profils 3G/Edge/100 % Loss/High Latency DNS | **Charles Proxy** / **Proxyman** : Throttle Settings (presets 3G/4G + custom kbps/latency/% loss) |
| Coupure nette ponctuelle           | Mode avion device, ou `adb shell svc wifi disable` / `svc data disable`                                         | Mode avion device                                                                                                                      | Charles/Proxyman : « Stop recording » / kill proxy ; ou couper le Wi-Fi du Mac hôte               |
| Coupure temporisée (timing précis) | Script `adb shell svc data disable && sleep N && svc data enable`                                               | Network Link Conditioner profil 100 % Loss activable à la volée                                                                        | Proxyman « Map Local » + breakpoint pour suspendre une requête au moment voulu                    |
| Inspection requêtes / doublons     | Charles/Proxyman (voir 2 POST identiques = doublon)                                                             | idem                                                                                                                                   | idem — **outil de vérité pour l'idempotence**                                                     |
| Mode avion intermittent            | Quick Settings toggle, ou script `svc` en boucle                                                                | Toggle Centre de contrôle                                                                                                              | n/a                                                                                               |
| WebSocket / LiveKit                | Charles « WebSocket » view ; logs `socketStore` ; bannières UI                                                  | idem                                                                                                                                   | Proxyman WebSocket inspector                                                                      |

**Réglages recommandés du proxy (Charles/Proxyman) pour les coupures « au milieu » :**

- Activer **Breakpoints** sur l'URL ciblée (`/messages`, `/rooms/:id/join`, `/upload/avatar`, `/auth/verify-otp`) → suspendre la requête, couper le réseau hôte, puis relâcher.
- Activer **Throttle** avec un preset pour reproduire P4/P5/P11 de façon répétable.

> Note : le store réseau (`networkStore`) lit `@react-native-community/netinfo` (lazy). La bannière hors-ligne (`OfflineBanner`) ne s'affiche que si le device se déclare déconnecté. Une **perte applicative** (proxy qui drop) sans bascule NetInfo → pas de bannière mais erreurs `network`/`timeout` ; les deux chemins sont à tester (cf. NET-050).

---

## 2. Coupure réseau PENDANT une action

> Principe général attendu (référence : `errorHandler.ts`, `interceptors.ts`, mutations React Query) :
>
> 1. **Pas de double-effet** (idempotence, cf. §3).
> 2. **Message d'erreur clair et localisé** (jamais une stack ni « Request failed with status code … »).
> 3. **Possibilité de réessayer** (retry manuel, pull-to-refresh, ou re-soumission gardée).
> 4. **Aucun crash, aucun spinner infini** (le timeout 15 s borne l'attente).

### NET-001 — Coupure pendant l'envoi d'un message direct (DM)

- **Pré-conditions** : utilisateur authentifié ; conversation ouverte avec un peer en _mutual follow_ ; profil P3 puis bascule coupure.
- **Étapes** :
  1. Saisir un texte dans `chat.inputPlaceholder` (« Écrire un message… »).
  2. **Couper le réseau (mode avion ou breakpoint proxy suspendu) JUSTE avant** d'appuyer sur Envoyer (`chat.sendA11y`).
  3. Appuyer sur Envoyer.
  4. Laisser filer le timeout (≤ 15 s).
- **Résultat attendu** : le `useSendMessage` échoue avec `kind:'timeout'` (si coupure pendant la requête) ou `network` (si coupure nette). Aucun message n'apparaît dans le fil (l'`onSuccess` qui fait `setQueryData` ne s'exécute pas). Une erreur localisée s'affiche (toast/inline) : FR « La requête a pris trop de temps. Réessaie. » / « Impossible de joindre le serveur. Vérifie ta connexion. ». L'input conserve le texte saisi (pas de perte).
- **Critère OK/KO** : OK si 0 message créé côté serveur (vérifier via Charles : aucun POST `/messages` n'aboutit en 2xx), erreur localisée, texte préservé. KO si message fantôme affiché, crash, spinner infini, ou message anglais brut/stack.
- **Durée** : 5 min.

### NET-002 — Coupure pendant « Rejoindre une room »

- **Pré-conditions** : feed chargé avec une room live ; profil P4.
- **Étapes** :
  1. Appuyer sur Rejoindre (`feed.join`).
  2. **Couper le réseau au moment où l'écran Room commence à monter** (entre l'appel join et la récupération du token LiveKit `roomService.getLivekitToken`).
- **Résultat attendu** : l'audio ne démarre pas ; bannière `room.audioConnecting` (« 🔊 Connexion audio… ») puis basculement vers un état d'erreur/reconnexion sans crash. Si le token échoue, `startRoomAudio` rejette ; l'UI reste sur l'écran room (chat/main levée restent les fonctions non-audio) ou affiche `room.unavailable` (« Room indisponible ») / `room.audioError`. Aucune session LiveKit pendante.
- **Critère OK/KO** : OK si pas de crash, état lisible, et à la reconnexion (NET-002b) l'audio se rattrape ou un retry est possible. KO si écran figé, double-join, ou audio « connecté » mensonger.
- **Durée** : 8 min.

### NET-002b — Reprise après la coupure de NET-002 (enchaîné)

- **Étapes** : rétablir le réseau après ~10 s.
- **Résultat attendu** : LiveKit déclenche son rejoin manuel (max 5 tentatives, backoff 2 s→30 s). Bannière `room.audioReconnecting` (« 🔄 Reconnexion audio… ») visible pendant la reprise, puis audio rétabli.
- **Critère OK/KO** : OK si audio revient ≤ 5 tentatives et bannière se ferme. KO si l'app reste « reconnecting » indéfiniment au-delà du budget de 5 tentatives sans message clair.
- **Durée** : 6 min.

### NET-003 — Coupure pendant l'upload d'avatar

- **Pré-conditions** : écran Modifier le profil ou Onboarding (`profile.edit.changePhotoA11y`) ; image sélectionnée ; profil P5 (lent, pour rendre l'upload long).
- **Étapes** :
  1. Choisir une photo (déclenche `mediaService.uploadAvatar`, timeout **60 s**).
  2. **Couper le réseau pendant le transfert base64** (après ~3 s, alors que la barre/spinner tourne).
- **Résultat attendu** : la requête échoue (`network`/`timeout`) avant 60 s ; message FR « Impossible de mettre à jour le profil. Réessayez. » (`profile.edit.failedToUpdate`) ou erreur générique localisée. Le profil **n'est pas** mis à jour avec une URL vide/locale (`profileService.update` n'accepte que des URLs http(s) — un `file://` ne doit jamais être persisté). L'ancien avatar reste affiché.
- **Critère OK/KO** : OK si aucune URL invalide enregistrée, ancien avatar conservé, retry possible. KO si avatar cassé/placeholder enregistré, crash, ou attente bloquée jusqu'à 60 s sans feedback.
- **Durée** : 7 min.

### NET-004 — Coupure pendant la requête OTP (envoi du code)

- **Pré-conditions** : écran Numéro de téléphone ; numéro E.164 valide ; case 16 ans cochée ; profil P4.
- **Étapes** :
  1. Appuyer sur « Recevoir un code » (`auth.phone.submit`).
  2. **Couper le réseau juste après le tap** (pendant `requestOtp` → POST `/auth/send-otp`).
- **Résultat attendu** : le bouton est `disabled`+`loading` pendant `isSubmitting` (pas de double tap possible). À l'échec, `requestOtp` rejette ; `handleApiError` mappe l'erreur ; **pas de navigation vers Otp** (la navigation est dans le `try`, après le `await`). Erreur localisée affichée. L'utilisateur peut re-soumettre une fois la connexion revenue.
- **Critère OK/KO** : OK si on reste sur PhoneScreen, message clair, bouton réactivé après l'échec. KO si navigation vers Otp sans code envoyé, double envoi SMS, spinner figé.
- **Durée** : 5 min.

### NET-005 — Coupure pendant la vérification OTP (auto-submit 6 chiffres)

- **Pré-conditions** : écran Code OTP ; code valide connu (log dev) ; profil P9 (latence 800 ms).
- **Étapes** :
  1. Saisir les 6 chiffres (déclenche `verifyOtp` automatiquement).
  2. **Couper le réseau pendant le `verifyOtp`** (latence haute laisse une fenêtre).
- **Résultat attendu** : `isSubmitting` bloque toute nouvelle soumission ; à l'échec, `catch` affiche `auth.otp.errors.invalid` (« Code invalide. 6 chiffres attendus. »), incrémente `attempts`, vide le champ et joue le shake. **Aucune session établie**, **pas de navigation** vers Name/Main. Le compteur de tentatives ne doit pas être incrémenté à tort par un échec **réseau** vs un échec de **code** — cf. KO ci-dessous.
- **Critère OK/KO** : OK si pas de session fantôme, pas de navigation, retry possible. **KO connu à vérifier** : un échec purement réseau consomme une tentative `attempts++` alors que le code n'a pas été testé → après 5 blips réseau l'utilisateur est « locked » à tort (`auth.otp.errors.tooManyAttempts`). À remonter si confirmé.
- **Durée** : 6 min.

### NET-006 — Coupure pendant une action admin destructive (Suspendre / Fermer la room / Changer le rôle)

- **Pré-conditions** : compte ADMIN/SUPER_ADMIN ; écran Détail utilisateur ou Rooms admin ; profil P7 (perte 20 %).
- **Étapes** :
  1. Confirmer l'Alert (ex. « Suspendre 24h » → `admin.userDetail.suspend24h`, ou « Fermer la room » → `admin.rooms.closeRoom`).
  2. **Couper le réseau pendant la mutation** (POST `/admin/...`).
- **Résultat attendu** : bouton désactivé pendant `busy` (pas de double-clic → pas de double suspension/double force-end). À l'échec : message localisé (`admin.rooms.failedEnd` « Échec de la fermeture de la room. » / `admin.reports.actionFailed`). État serveur inchangé. Après reconnexion + pull-to-refresh, l'état réel est resynchronisé (badge Suspendu/LIVE).
- **Critère OK/KO** : OK si 0 ou 1 action appliquée (jamais 2), message clair, resync via refresh. KO si double-effet (room fermée deux fois, double entrée au journal d'audit), navigation `goBack` exécutée alors que l'action a échoué.
- **Durée** : 10 min.

### NET-007 — Coupure pendant « Usurper » (impersonation)

- **Pré-conditions** : SUPER_ADMIN ; Détail utilisateur ; profil P4.
- **Étapes** : appuyer sur « Usurper » (`admin.userDetail.impersonateBtn`) puis **couper le réseau pendant la récupération du token d'usurpation**.
- **Résultat attendu** : en cas d'échec, **aucune navigation** (`popToTop` ne doit pas s'exécuter) et **aucune session d'usurpation pendante** (`impersonationState` reste vide). Le super-admin garde sa session.
- **Critère OK/KO** : OK si on reste sur la fiche, session admin intacte, pas de token d'usurpation orphelin. KO si UI passe en mode usurpé sans token valide, ou navigation effectuée.
- **Durée** : 6 min.

### NET-008 — Coupure pendant un export CSV admin

- **Pré-conditions** : SUPER_ADMIN ; Accueil admin ; profil P5.
- **Étapes** : appuyer sur « Exporter les utilisateurs en CSV » (`admin.home.csvA11yUsers`) puis **couper pendant le GET `/admin/export/users.csv`**.
- **Résultat attendu** : message `admin.home.exportError` (« Échec de l'export »). Rien n'est copié dans le presse-papier (pas de CSV partiel/tronqué). La feuille de partage ne s'ouvre pas sur un contenu vide.
- **Critère OK/KO** : OK si export non déclenché, message clair, presse-papier inchangé. KO si CSV tronqué copié/partagé, ou feuille de partage vide.
- **Durée** : 5 min.

### NET-009 — Coupure pendant un pull-to-refresh (listes non temps-réel)

- **Pré-conditions** : écran avec `RefreshControl` (Journal d'audit, Signalements, Rooms admin, Utilisateurs admin, Messages) ; profil P10 (latence 2 s).
- **Étapes** : déclencher le pull-to-refresh puis **couper le réseau pendant le refetch**.
- **Résultat attendu** : le spinner de refresh s'arrête (ne reste pas accroché en haut). État d'erreur dédié si la liste était vide (`admin.audit.errorTitle/errorBody`, `admin.reports.errorTitle/errorBody`, `messages.couldNotLoad` + `messages.pullToRetry` « Tire vers le bas pour réessayer. »). Les données déjà affichées restent visibles (pas d'écran blanc).
- **Critère OK/KO** : OK si spinner libéré, données conservées, retry par re-pull. KO si spinner figé, liste vidée à tort, crash.
- **Durée** : 6 min.

### NET-010 — Coupure pendant le wave (salut)

- **Pré-conditions** : profil d'un follower ouvert ; profil P3.
- **Étapes** : appuyer sur Wave (`profile.wave`) puis **couper pendant `useExtWave`**.
- **Résultat attendu** : pas de confirmation `profile.waveSent` (« Wave envoyé 🌊 ») affichée à tort. Le bouton se réarme. Aucun double wave si on retape après échec (cf. NET-031).
- **Critère OK/KO** : OK si état « envoi… » → erreur sans confirmation mensongère. KO si « Wave envoyé » affiché alors que la requête a échoué.
- **Durée** : 4 min.

---

## 3. Idempotence — double soumission sur réseau lent

> Objectif : sur un réseau lent (P4/P5/P9/P10), un double appui (ou un retry pendant qu'une 1ʳᵉ requête est encore en vol) ne doit JAMAIS créer de doublon. **Outil de vérité : Charles/Proxyman** — compter les requêtes 2xx réellement abouties.

### NET-020 — Double soumission OTP (envoi du code)

- **Pré-conditions** : PhoneScreen ; numéro valide ; profil P10.
- **Étapes** : taper « Recevoir un code » **deux fois rapidement** pendant la latence de 2 s.
- **Résultat attendu** : le bouton est `disabled` dès le 1ᵉʳ tap (`isSubmitting`), donc **un seul** POST `/auth/send-otp`. Même si deux passaient, le backend invalide les codes précédents (`otpCode.updateMany isUsed:true`) → seul le dernier code est valide ; le rate-limit horaire borne les abus.
- **Critère OK/KO** : OK si 1 SMS reçu (ou au pire 1 seul code valide). KO si 2 SMS avec 2 codes utilisables simultanément.
- **Durée** : 5 min.

### NET-021 — Double auto-submit OTP (vérification)

- **Pré-conditions** : OtpScreen ; profil P9.
- **Étapes** : tenter de re-déclencher la vérification (re-coller le code) pendant que `verifyOtp` est en vol.
- **Résultat attendu** : `isSubmitting` empêche un 2ᵉ appel. Backend : le code est **one-shot** (`isUsed:true` posé avant émission des tokens) → un 2ᵉ verify renverrait AUTH_002 « expired or not found ». La création de compte est **find-or-create** → jamais 2 comptes pour le même numéro.
- **Critère OK/KO** : OK si 1 seule session établie, 1 seul compte. KO si double création de compte ou double émission de tokens.
- **Durée** : 5 min.

### NET-022 — Double envoi du même message (DM)

- **Pré-conditions** : conversation ouverte ; profil P5.
- **Étapes** :
  1. Envoyer un message.
  2. Pendant que la requête est lente (réseau P5), **réessayer / re-tap Envoyer** (ou re-soumettre depuis l'input si l'app le permet).
- **Résultat attendu** : **À VÉRIFIER / RISQUE CONNU** — `chatService.send` (`backend/.../chat.service.ts`) **ne déduplique pas** (création directe d'un `Message`, sans clé d'idempotence). Si l'UI ne garde pas le bouton désactivé pendant l'envoi, **deux messages identiques** seront créés.
- **Critère OK/KO** : OK si 1 seul message créé (vérifier via Charles : un seul POST `/messages` en 2xx ; et un seul item dans le fil). KO si 2 messages identiques apparaissent. **Si KO : remonter en P1** — recommandation : désactiver le bouton pendant la mutation et/ou ajouter une clé d'idempotence (`Idempotency-Key`/`clientMessageId`) côté backend.
- **Durée** : 8 min.

### NET-023 — Double follow / unfollow rapide

- **Pré-conditions** : profil d'un utilisateur non suivi ; profil P4.
- **Étapes** : taper Suivre (`profile.follow`) **deux fois** pendant la latence.
- **Résultat attendu** : idempotent côté serveur — `followService.follow` attrape la violation d'unicité Prisma `P2002` et traite comme succès **sans** ré-incrémenter les compteurs ni renvoyer une 2ᵉ notification « New follower ». Le compteur de followers ne bouge que de 1.
- **Critère OK/KO** : OK si +1 follower exactement, 1 seule notification reçue côté cible, compteur dénormalisé cohérent (vérifiable via `emitUserFollowerCount` / badge temps réel). KO si +2, double notification, ou compteur incohérent.
- **Durée** : 6 min.

### NET-024 — Double invitation (room / house) sur réseau lent

- **Pré-conditions** : écran Inviter dans la Room (`rooms.invite`) ou Inviter un membre (`houses.invite`) ; profil P5. (Invitations signées HMAC + quota, cf. branche identité/viralité.)
- **Étapes** : sélectionner un destinataire et taper Envoyer **deux fois** pendant la latence.
- **Résultat attendu** : une seule invitation envoyée ; le **quota d'invitations** (`invite.remaining`) ne décrémente que de 1. Pas de double notification d'invitation côté destinataire.
- **Critère OK/KO** : OK si quota −1 et 1 invitation. KO si quota −2 ou 2 invitations.
- **Durée** : 7 min.

### NET-025 — Double création de room sur réseau lent

- **Pré-conditions** : écran Nouvelle room ; profil P9.
- **Étapes** : remplir le sujet, taper « Démarrer » (`createRoom.startRoom`) **deux fois**.
- **Résultat attendu** : une seule room créée. À l'échec : `createRoom.errorTitle`/`errorBody` (« Création impossible » / « Impossible de créer la room. Réessaie. »). Sinon navigation unique vers la room.
- **Critère OK/KO** : OK si 1 room dans le feed/historique. KO si 2 rooms dupliquées ou 2 écrans Room empilés.
- **Durée** : 6 min.

### NET-026 — Multi-tap navigation (empilement d'écrans)

- **Pré-conditions** : feed / liste admin ; profil P8.
- **Étapes** : taper rapidement une ligne (ex. « Open Jane Doe » → AdminUserDetail, ou une room du feed) plusieurs fois.
- **Résultat attendu** : un seul écran poussé (pas d'empilement de N copies de AdminUserDetail / RoomScreen). Le Retour ramène d'un seul niveau.
- **Critère OK/KO** : OK si 1 push. KO si plusieurs écrans identiques empilés.
- **Durée** : 4 min.

### NET-027 — Double action admin de modération (resolve/dismiss, suspend)

- **Pré-conditions** : Signalements admin ; profil P7.
- **Étapes** : après confirmation de l'Alert « Résoudre », re-déclencher l'action pendant que la mutation est en vol (si le bouton n'est pas désactivé).
- **Résultat attendu** : bouton désactivé pendant `busy` → un seul POST `/admin/reports/:id/resolve`. Pas de double entrée au journal d'audit (`admin.audit.roles.reportResolved`).
- **Critère OK/KO** : OK si 1 résolution + 1 ligne d'audit. KO si 2 lignes d'audit pour la même action.
- **Durée** : 6 min.

---

## 4. Reconnexion WebSocket / LiveKit

> Références : `socketClient.ts` (Socket.IO), `socketStore.ts` (états `idle|connecting|connected|reconnecting|disconnected`), `roomAudioService.ts` (LiveKit rejoin), i18n `socket.*` et `room.audio*`.

### NET-040 — Reconnexion WebSocket auto après coupure courte

- **Pré-conditions** : session active sur un écran temps réel (feed, chat, room) ; profil P3.
- **Étapes** :
  1. Couper le réseau **5 s**.
  2. Le rétablir.
- **Résultat attendu** : `socketStore` passe `connected` → `disconnected` → `reconnecting` → `connected`. Bannière `socket.disconnected` (« Connexion perdue — reconnexion automatique. ») puis `socket.reconnecting` (« Reconnexion… »), puis disparition à la reprise. Reconnexion automatique (delay 1 s, max 10 s). **Un seul** socket singleton (pas de 2ᵉ `io()` créé → pas d'événements dupliqués).
- **Critère OK/KO** : OK si reconnexion < ~15 s, événements non dupliqués (ex. un message reçu une seule fois), bannière disparaît. KO si bannière persistante, doublons d'événements, ou socket fantôme.
- **Durée** : 6 min.

### NET-041 — Re-sync de l'état après reconnexion WebSocket

- **Pré-conditions** : conversation ouverte ; un 2ᵉ device/utilisateur envoie un message **pendant** la coupure du device testé.
- **Étapes** :
  1. Couper le réseau du device A.
  2. Depuis B, envoyer 2 messages à A.
  3. Rétablir A.
- **Résultat attendu** : à la reconnexion, `useChatSocket` reçoit `chat:message` et invalide les caches React Query (`conversations`, `unread`, `messages(peer)`) → les 2 messages manqués apparaissent, badge non-lu correct. Aucun message dupliqué (les handlers se ré-attachent proprement, `.off` au cleanup).
- **Critère OK/KO** : OK si les 2 messages ratés s'affichent, badge exact, 0 doublon. KO si messages manquants, badge faux, ou doublons.
- **Durée** : 10 min.

### NET-042 — Reconnexion WebSocket avec token expiré (refresh auth)

- **Pré-conditions** : session active dont l'access token est sur le point d'expirer (≈ 15 min) ; profil P4. Forcer l'expiration si possible.
- **Étapes** : provoquer une reconnexion socket alors que le token est expiré (couper/rétablir).
- **Résultat attendu** : le `connect_error` contient « auth » → `refreshAuthAndReconnect` émet un probe `GET /users/me`, l'interceptor REST fait le refresh silencieux, écrit le nouveau token, puis le callback `auth` du socket relit le token frais et reconnecte. Pas de déconnexion utilisateur si le refresh token est valide.
- **Critère OK/KO** : OK si reconnexion transparente sans retour au Landing. KO si l'utilisateur est déconnecté à tort sur un simple token expiré, ou boucle refresh→reconnect→error.
- **Durée** : 8 min.

### NET-043 — Réseau d'entreprise / DPI qui tue les WebSockets longs

- **Pré-conditions** : simuler un proxy qui bloque le WS upgrade mais laisse passer le polling HTTP (Charles : bloquer l'upgrade `Upgrade: websocket`). Profil P8.
- **Étapes** : se connecter et rester sur un écran temps réel quelques minutes.
- **Résultat attendu** : Socket.IO reste vivant via `polling` (transports `['polling','websocket']`) ; le temps réel continue de fonctionner même sans WebSocket. La bannière ne reste pas bloquée sur « reconnexion ».
- **Critère OK/KO** : OK si les événements temps réel arrivent encore via polling. KO si l'app considère le temps réel mort alors que le HTTP passe.
- **Durée** : 8 min.

### NET-044 — Reprise audio LiveKit après coupure (rejoin auto)

- **Pré-conditions** : **build EAS dev-client** (audio indisponible en Expo Go → `room.audioUnsupported`) ; room rejointe, audio actif ; profil P6 (perte 5 %).
- **Étapes** :
  1. Couper le réseau **10 s** pendant que l'audio joue.
  2. Rétablir.
- **Résultat attendu** : la SDK LiveKit tente sa reconnexion interne → état `reconnecting` → bannière `room.audioReconnecting` (« 🔄 Reconnexion audio… »). En cas d'échec dur (`disconnected`), le rejoin manuel s'enclenche (max 5 tentatives, backoff 2 s→30 s) : refetch du token (`getLivekitToken`), reconnexion, re-mute selon `isMuted`. À la reprise, `lastStatus` repasse `connected`, le compteur de tentatives se réinitialise.
- **Critère OK/KO** : OK si l'audio revient et la bannière se ferme dans le budget de 5 tentatives. KO si audio muet définitif sans message, ou tentatives au-delà de 5 sans état clair.
- **Durée** : 10 min.

### NET-045 — Renouvellement de token LiveKit en pleine session

- **Pré-conditions** : dev-client ; room avec token court ; session > durée du token. Profil P3.
- **Étapes** : rester en room jusqu'au seuil de renouvellement (~30 s avant expiration).
- **Résultat attendu** : `scheduleRenewal` déclenche un fetch + reconnect transparent avant expiration ; l'audio ne coupe pas (ou coupe < 1 s). Mute préservé.
- **Critère OK/KO** : OK si pas d'éjection à l'expiration du token, audio continu. KO si éjection « token expiré » alors que la session est légitime.
- **Durée** : 8 min (selon TTL token).

### NET-046 — Changement de rôle pendant réseau dégradé (re-token + reconnect audio)

- **Pré-conditions** : dev-client ; en room comme auditeur ; profil P6.
- **Étapes** : un host vous promeut SPEAKER (`room:role_changed`) **pendant** un réseau perte 5 %.
- **Résultat attendu** : `handleSocketRoleChange` refetch un token (canPublish=true), disconnect+reconnect LiveKit, re-applique le mute. Alerte `room.alert.roleSpeaker`. Si le re-token échoue (réseau), l'app retente au prochain `role_changed` sans crasher.
- **Critère OK/KO** : OK si le rôle bascule et le micro devient disponible après reconnexion. KO si crash, ou rôle UI désynchronisé du droit de publier réel.
- **Durée** : 8 min.

### NET-047 — Force-end d'une room (admin) propagé aux participants

- **Pré-conditions** : 1 admin + ≥ 1 participant en room (dev-client) ; participant sur profil P4.
- **Étapes** : l'admin fait « Fermer la room » (force-end) ; observer le participant.
- **Résultat attendu** : le participant reçoit l'événement room ended → `room.alert.endedTitle/endedBody` (« Room terminée » / « … fermée par l'hôte. ») ; le canal LiveKit ferme proprement, pas de rejoin en boucle (la fermeture est volontaire, pas un échec réseau). Sortie propre vers le feed.
- **Critère OK/KO** : OK si éjection propre + message, pas de tentative de rejoin. KO si le participant tente de rejoindre une room morte (boucle 5 tentatives), ou reste « connecté » fantôme.
- **Durée** : 8 min.

---

## 5. Timeouts et messages d'erreur i18n (FR/EN)

> Chaque cas doit être exécuté **une fois en FR, une fois en EN** (changer la langue système ou le réglage in-app). Vérifier que le texte affiché correspond EXACTEMENT aux clés ci-dessous et qu'aucune stack/erreur HTTP brute ne fuit.

### NET-050 — Timeout pur (latence ≥ timeout) → message `timeout`

- **Pré-conditions** : profil P10 + breakpoint proxy qui retient la réponse > 15 s.
- **Étapes** : déclencher n'importe quelle requête (ex. charger le feed, envoyer un DM) et laisser filer > 15 s.
- **Résultat attendu** : `ECONNABORTED` → `kind:'timeout'`.
  - FR (`errorMessages.timeout`) : « La requête a pris trop de temps. Réessaie. »
  - EN : « The request took too long. Please try again. »
- **Critère OK/KO** : OK si message timeout exact, retry proposé. KO si « network », stack, ou anglais en mode FR (et inversement).
- **Durée** : 6 min (×2 langues).

### NET-051 — Coupure nette → message `network`

- **Pré-conditions** : mode avion ON ; profil n/a.
- **Étapes** : déclencher une requête réseau.
- **Résultat attendu** : pas de réponse → `kind:'network'`.
  - FR (`errorMessages.network`) : « Impossible de joindre le serveur. Vérifie ta connexion. »
  - EN : « We couldn't reach the server. Check your connection. »
  - En complément, si NetInfo bascule offline : bannière `offline.banner` — FR « Hors ligne — les messages seront envoyés une fois la connexion rétablie. » / EN « Offline — messages will be sent once the connection is back. »
- **Critère OK/KO** : OK si message network exact + bannière offline (si NetInfo détecte). KO si message timeout, ou aucune indication.
- **Durée** : 6 min (×2 langues).

### NET-052 — Bannières socket FR/EN

- **Pré-conditions** : écran temps réel ; couper/rétablir le réseau.
- **Résultat attendu** :
  - `socket.disconnected` — FR « Connexion perdue — reconnexion automatique. » / EN « Connection lost — reconnecting automatically. »
  - `socket.reconnecting` — FR « Reconnexion… » / EN « Reconnecting… »
- **Critère OK/KO** : OK si les deux états s'affichent dans la bonne langue puis disparaissent. KO si texte figé, mauvaise langue, ou clé brute affichée.
- **Durée** : 5 min (×2 langues).

### NET-053 — Bannières audio room FR/EN

- **Pré-conditions** : dev-client en room ; couper/rétablir.
- **Résultat attendu** :
  - `room.audioConnecting` — FR « 🔊 Connexion audio… » / EN « 🔊 Connecting audio… »
  - `room.audioReconnecting` — FR « 🔄 Reconnexion audio… » / EN « 🔄 Reconnecting audio… »
  - En Expo Go (pas de natif) : `room.audioUnsupported` — FR « ⚠️ L'audio nécessite un dev-client EAS… » / EN équivalent.
- **Critère OK/KO** : OK si bannières correctes selon l'état et la langue. KO si mauvais état/langue/clé brute.
- **Durée** : 6 min (×2 langues).

### NET-054 — Erreurs de chargement de listes FR/EN (état d'erreur + retry)

- **Pré-conditions** : couper le réseau AVANT le 1ᵉʳ chargement de chaque liste ; profil mode avion.
- **Étapes** : ouvrir Feed, Messages, Signalements admin, Journal d'audit, Utilisateurs admin, Rooms admin.
- **Résultat attendu** : chaque écran montre son état d'erreur localisé avec invite à réessayer :
  - Feed : `feed.couldNotLoad` + `feed.checkConnection` (« Impossible de charger les rooms » / « Vérifie ta connexion et réessaie. »).
  - Messages : `messages.couldNotLoad` + `messages.pullToRetry`.
  - Signalements : `admin.reports.errorTitle` + `errorBody`.
  - Journal d'audit : `admin.audit.errorTitle` + `errorBody`.
  - Utilisateurs : `admin.users.errorTitle` + `errorBody`.
  - Rooms : `admin.rooms.errorLoadingRooms`.
  - Stats admin : `admin.home.errorStats`.
- **Critère OK/KO** : OK si chaque écran a un état d'erreur lisible + moyen de réessayer (pull-to-refresh / bouton). KO si écran blanc, spinner infini, ou crash.
- **Durée** : 12 min (×2 langues).

### NET-055 — Rate-limit / trop de tentatives sous réseau dégradé

- **Pré-conditions** : OtpScreen ; profil P5.
- **Étapes** : épuiser le budget (5 tentatives) ou dépasser le rate-limit OTP horaire backend.
- **Résultat attendu** : `auth.otp.errors.tooManyAttempts` (FR « Trop de tentatives. Renvoie un nouveau code. »). Le renvoi est bloqué tant que le cooldown 60 s n'est pas écoulé (`auth.otp.resendIn` « Renvoyer dans {{time}} »), puis « Renvoyer le code » (`auth.otp.resend`) réinitialise `attempts`.
- **Critère OK/KO** : OK si message exact, cooldown respecté, reset après renvoi. KO si rate-limit serveur (429) affiché comme erreur générique non localisée.
- **Durée** : 6 min (×2 langues).

---

## 6. Mode avion intermittent (P12) — scénarios cycliques

### NET-060 — Cycles avion ON/OFF pendant navigation libre

- **Pré-conditions** : session active ; script ou toggle manuel : avion ON 8 s / OFF 12 s, ×5 cycles. Naviguer entre feed, chat, profil pendant les cycles.
- **Résultat attendu** : à chaque OFF, le socket reconnecte, les listes se rechargent (pull ou auto), la bannière offline/socket apparaît puis disparaît au bon rythme. Aucun crash, aucune fuite de handlers (pas de doublons d'événements croissants au fil des cycles).
- **Critère OK/KO** : OK si stable sur 5 cycles, doublons = 0, mémoire stable. KO si crash, doublons croissants, bannière coincée, ou app à reconnecter manuellement (kill/restart).
- **Durée** : 12 min.

### NET-061 — Avion ON pendant un envoi, OFF après → comportement de file/retry

- **Pré-conditions** : chat ouvert ; avion OFF.
- **Étapes** :
  1. Avion ON.
  2. Tenter d'envoyer un DM (échoue : network).
  3. Avion OFF.
- **Résultat attendu** : la bannière `offline.banner` promet un envoi différé (« … les messages seront envoyés une fois la connexion rétablie. »). **À VÉRIFIER** : l'app possède-t-elle une vraie file d'envoi différé, ou l'utilisateur doit-il re-soumettre manuellement ? D'après le code (`useSendMessage` sans file de retry persistante), l'envoi **n'est pas** automatiquement rejoué — le message échoue et reste à renvoyer à la main.
- **Critère OK/KO** : OK si le comportement réel correspond au texte de la bannière (si la bannière promet un envoi différé, il doit avoir lieu ; sinon adapter le wording). KO si le texte promet une file inexistante (incohérence UX) → **remonter** : soit implémenter la file, soit reformuler `offline.banner`. Dans tous les cas, pas de doublon au renvoi manuel (cf. NET-022).
- **Durée** : 8 min.

---

## 7. Tableau récapitulatif

| ID             | Catégorie              | Action / surface         | Profil clé      | Risque principal             | Durée |
| -------------- | ---------------------- | ------------------------ | --------------- | ---------------------------- | ----- |
| NET-001        | Coupure pendant action | Envoi DM                 | P3+coupure      | Message fantôme              | 5     |
| NET-002 / 002b | Coupure pendant action | Rejoindre room + reprise | P4              | Session pendante / audio     | 14    |
| NET-003        | Coupure pendant action | Upload avatar (60 s)     | P5              | URL invalide persistée       | 7     |
| NET-004        | Coupure pendant action | Requête OTP              | P4              | Navigation sans SMS          | 5     |
| NET-005        | Coupure pendant action | Vérif OTP                | P9              | Tentative consommée à tort   | 6     |
| NET-006        | Coupure pendant action | Action admin destructive | P7              | Double-effet modération      | 10    |
| NET-007        | Coupure pendant action | Usurper                  | P4              | Session usurpée pendante     | 6     |
| NET-008        | Coupure pendant action | Export CSV               | P5              | CSV tronqué                  | 5     |
| NET-009        | Coupure pendant action | Pull-to-refresh          | P10             | Spinner figé                 | 6     |
| NET-010        | Coupure pendant action | Wave                     | P3              | Confirmation mensongère      | 4     |
| NET-020        | Idempotence            | Double envoi OTP         | P10             | 2 codes valides              | 5     |
| NET-021        | Idempotence            | Double vérif OTP         | P9              | Double compte/session        | 5     |
| NET-022        | Idempotence            | Double DM                | P5              | **Doublon message (risque)** | 8     |
| NET-023        | Idempotence            | Double follow            | P4              | +2 / double notif            | 6     |
| NET-024        | Idempotence            | Double invitation        | P5              | Quota −2                     | 7     |
| NET-025        | Idempotence            | Double création room     | P9              | 2 rooms                      | 6     |
| NET-026        | Idempotence            | Multi-tap navigation     | P8              | Empilement écrans            | 4     |
| NET-027        | Idempotence            | Double resolve/suspend   | P7              | Double audit                 | 6     |
| NET-040        | Reconnexion WS         | Reconnexion auto         | P3              | Doublons events              | 6     |
| NET-041        | Reconnexion WS         | Re-sync état             | coupure         | Messages manqués             | 10    |
| NET-042        | Reconnexion WS         | Refresh auth             | P4              | Déconnexion à tort           | 8     |
| NET-043        | Reconnexion WS         | DPI / WS bloqué          | P8              | Temps réel mort              | 8     |
| NET-044        | Reconnexion LiveKit    | Rejoin audio             | P6 (dev-client) | Audio muet définitif         | 10    |
| NET-045        | Reconnexion LiveKit    | Renouvellement token     | P3 (dev-client) | Éjection token               | 8     |
| NET-046        | Reconnexion LiveKit    | Changement de rôle       | P6 (dev-client) | Rôle désynchronisé           | 8     |
| NET-047        | Reconnexion LiveKit    | Force-end propagé        | P4 (dev-client) | Rejoin en boucle             | 8     |
| NET-050        | i18n/timeout           | Timeout pur              | P10             | Mauvais kind/langue          | 6     |
| NET-051        | i18n/network           | Coupure nette            | avion           | Mauvais kind/langue          | 6     |
| NET-052        | i18n/socket            | Bannières socket         | coupure         | Langue/clé brute             | 5     |
| NET-053        | i18n/audio             | Bannières audio          | dev-client      | Langue/état                  | 6     |
| NET-054        | i18n/listes            | États d'erreur listes    | avion           | Écran blanc                  | 12    |
| NET-055        | i18n/rate-limit        | Trop de tentatives       | P5              | Erreur non localisée         | 6     |
| NET-060        | Avion intermittent     | Cycles navigation        | P12             | Fuite handlers               | 12    |
| NET-061        | Avion intermittent     | Envoi + reprise          | P12             | File promise/inexistante     | 8     |

**Durée totale indicative : ~4 h 30** (hors temps de mise en place des outils ; doubler les cas i18n pour FR + EN est inclus dans les durées).

---

## 8. Points d'attention transversaux (à valider sur tous les cas)

1. **Jamais d'erreur brute** : aucun « Request failed with status code … », aucune stack, aucune clé i18n affichée telle quelle (`errorMessages.network` au lieu du texte).
2. **Pas de spinner infini** : le timeout global de 15 s borne toute attente (60 s pour l'avatar). Au-delà → état d'erreur.
3. **Pas de double-effet** : vérifier systématiquement via Charles/Proxyman le nombre de requêtes 2xx réellement abouties.
4. **Pas de déconnexion intempestive** : un blip réseau pendant un refresh token ne doit JAMAIS renvoyer au Landing (correctif documenté dans `interceptors.ts`).
5. **Singleton socket** : après login → logout → login, ou après N cycles avion, vérifier l'absence d'événements dupliqués (handlers orphelins).
6. **Audio = dev-client EAS uniquement** : tout cas LiveKit (NET-044→047) est invalide en Expo Go ; y vérifier seulement l'affichage de `room.audioUnsupported`.
7. **Parité i18n** : les clés FR (`fr.json`) et EN (`en.json`) doivent rester alignées ; signaler toute clé manquante dans une langue.
