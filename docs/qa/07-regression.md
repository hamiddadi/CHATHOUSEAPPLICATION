# 07 - Suite de regression ciblee (apres correctifs UI & backend)

> **ChatHouse** — app audio live facon Clubhouse (React Native / Expo SDK 55, temps reel WebSocket `socket.io-client` + audio **LiveKit** `@livekit/react-native`, push `expo-notifications`, i18n FR/EN, roles guest / standard / admin, Android + iOS, reseaux variables 3G/4G/5G/Wi-Fi).
>
> **Perimetre de reference** : 50 ecrans · 381 boutons/controles · 991 cas de test rediges dans `docs/qa/screens/01-…` a `50-…`.
> **But de ce document** : ne **pas** rejouer les 991 cas a chaque correctif. Apres un changement (refonte UI, evolution API/WebSocket, fix temps-reel), selectionner **par impact** le sous-ensemble strictement necessaire — puis confirmer la non-regression.

| Champ           | Valeur                                                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version cible   | app `0.1.0`                                                                                                                                                                  |
| Branche         | `feat/clubhouse-identity-virality`                                                                                                                                           |
| Backend de test | API locale `:4000` (REST + WebSocket), Postgres + Redis (docker)                                                                                                             |
| Date            | 2026-06-09                                                                                                                                                                   |
| Documents lies  | `00-plan-overview.md` (plan), `01-matrice-ecran-bouton.md` (matrices), `02-priorisation.md` (P0/P1/P2), `05-accessibilite.md` (a11y), `docs/qa/screens/*.md` (cas detailles) |

Les cas sont **references par leur ID** (prefixe d'ecran issu du fichier, ex. `AUTH-OTP-001`, `ROOM-LIVE-011`, `NOTIF-007`). On ne reecrit pas ici le detail des etapes — on pointe les cas existants a rejouer + les **assertions specifiques de regression** a ajouter.

---

## Sommaire

1. [Principe de selection par impact (mapping changement -> ecrans/boutons)](#1-principe-de-selection-par-impact)
2. [Suite SMOKE (~15 cas P0, < 30 min)](#2-suite-smoke--15-cas-p0--30-min)
3. [Regression UI (refonte composant : Button, Input, theme, navigation)](#3-regression-ui-apres-refonte-composant)
4. [Regression BACKEND (changement API / WebSocket : auth, feed rooms, messages, moderation)](#4-regression-backend-apres-changement-api--websocket)
5. [Regression temps-reel (reconnexion, synchronisation)](#5-regression-temps-reel-reconnexion-sync)
6. [Table de tracabilite changement -> cas](#6-table-de-tracabilite-changement--cas)

---

## 1. Principe de selection par impact

### 1.1 Regle de base

> **On ne re-teste que ce que le changement peut casser** — directement (le code touche) **et** indirectement (ses consommateurs : composant partage, contrat API, evenement WebSocket, cache React Query).

Pour chaque correctif, derouler les **3 cercles d'impact** :

| Cercle                        | Question                                                                                                   | Action                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **C1 — Direct**               | Quel ecran/bouton est litteralement modifie ?                                                              | Rejouer **tous** les cas P0/P1 de l'ecran touche.                                             |
| **C2 — Partage**              | Le code touche est-il partage (composant `src/shared`, hook, service, store, intercepteur axios, socket) ? | Rejouer **1 cas representatif par ecran consommateur** (le cas P0, sinon P1).                 |
| **C3 — Contrat / temps-reel** | Le changement modifie-t-il un contrat (REST payload, evenement WS, forme de cache) consomme ailleurs ?     | Rejouer la **regression backend (§4)** et/ou **temps-reel (§5)** ciblee sur l'endpoint/event. |

### 1.2 Matrice de mapping changement -> impact

| Type de changement                                                                                               | Cercle declenche | Cibles a re-tester                                                                                                                              | Suite a lancer           |
| ---------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **Composant `Button`** (`src/shared/components/Button`)                                                          | C2 (tres large)  | Tous les ecrans avec un `Button` : auth submit, room End/Leave, admin destructifs, messages Envoyer, houses Creer/Rejoindre, profil Enregistrer | §3.1 + SMOKE             |
| **Composant `Input`** (`src/shared/components/Input`)                                                            | C2               | Champs de saisie : Phone, Username, Name, recherche (Search/Invite/AddGrp/Compose), chat, profil edit, room titre, house create                 | §3.2                     |
| **`OtpInput`**                                                                                                   | C1 (1 ecran)     | OTP uniquement                                                                                                                                  | `AUTH-OTP-*` complet     |
| **Theme / tokens (`src/core/theme`)**                                                                            | C2 (global)      | Echantillon multi-feature + contraste a11y                                                                                                      | §3.3                     |
| **Navigation (`src/core/navigation`, linking, headers, `AdminHeader`)**                                          | C2 + C3          | Tous les retours, deep-links, tab-bar, `navigation.replace`, `popToTop`                                                                         | §3.4                     |
| **Endpoint AUTH** (`/auth/send-otp`, `/auth/verify-otp`, refresh token, intercepteur)                            | C3               | Phone, OTP, Landing dev-skip, et **toute l'app** (token expire/refresh)                                                                         | §4.1 + SMOKE             |
| **Endpoint FEED rooms** (`/rooms`, `/explore`, `/rooms/:id/*`)                                                   | C3               | Room-Feed, Search, Events, House-Detail (rooms de la house), Create                                                                             | §4.2                     |
| **Endpoint MESSAGES** (`/conversations`, `/groups/*`, `/voice`)                                                  | C3               | Chat, GChat, GInfo, AddGrp, MSG-List, MSG-New                                                                                                   | §4.3                     |
| **Endpoint MODERATION/ADMIN** (`/admin/*`, `/rooms/:id/force-end`, kick, role)                                   | C3               | Admin (6 ecrans), Room-Live (reception kick/role/mute/ended)                                                                                    | §4.4                     |
| **Evenement WebSocket** (room:_, chat:_, group:_, notification:_, hallway:_, maps:_)                             | C3               | Room-Live, Messages, Notifications, Room-Feed, Maps, Activity feed                                                                              | §5                       |
| **Pipeline audio LiveKit** (`useRoomAudio`, `useRoomSocket`, mute)                                               | C1 + C3          | Room-Live, Replays, EXT-Settings (qualite audio)                                                                                                | §5.4 + `ROOM-LIVE` audio |
| **Push** (`pushService`, `/push/register`, deep-link notif)                                                      | C3               | Notifications, Onboarding-Perm, Landing, House-Invite, Room-Invite                                                                              | §4.4 + R12               |
| **Cache React Query** (cles `roomKeys`, `messageKeys`, `profileKeys`, `houseKeys`, `adminKeys`, `notifications`) | C2               | Tout ecran s'appuyant sur la cle invalidee                                                                                                      | §4 ciblee                |

### 1.3 Heuristique de coupe (budget temps)

- **Hotfix isole** (1 ecran, pas de partage) : C1 seul + SMOKE. ~45 min.
- **Refonte composant partage** : C1 + C2 (echantillon) + SMOKE. ~2-3 h.
- **Changement de contrat API/WS** : C1 + C3 (§4 ou §5) + SMOKE. ~3-4 h.
- **Avant release** : SMOKE + §3 + §4 + §5 (100 % P0 + P1). Campagne complete.

> Toujours terminer par la **SMOKE (§2)** : c'est le filet de securite qui garantit qu'un correctif n'a pas casse le chemin critique.

---

## 2. Suite SMOKE (~15 cas P0, < 30 min)

**Objectif** : en moins de 30 minutes, prouver que le **chemin critique de bout en bout** fonctionne apres n'importe quel correctif. A jouer sur **1 device de reference par OS** (1 Android, 1 iOS), build EAS dev-client (pour l'audio), backend `:4000` joignable (pre-check `/metrics`).

**Regle GO/NO-GO** : **un seul KO sur la SMOKE = build rejete**, on ne lance pas la regression etendue tant que la SMOKE n'est pas verte.

| #   | Cas (ID existant) | Ecran         | Ce qu'on prouve                                                                          | Duree |
| --- | ----------------- | ------------- | ---------------------------------------------------------------------------------------- | ----- |
| S1  | `AUTH-LAND-001`   | Landing       | L'app boote (cold start, pas d'ecran noir R7), le CTA "Commencer" navigue                | 2 min |
| S2  | `AUTH-PHONE-009`  | Phone         | Numero E.164 + case 16 ans + "Recevoir un code" -> `POST /auth/send-otp` OK              | 2 min |
| S3  | `AUTH-OTP-004`    | OTP           | Saisie 6 chiffres -> auto-submit `POST /auth/verify-otp` -> session ouverte              | 2 min |
| S4  | `AUTH-UNAME-007`  | Username      | "Valider" -> `PATCH /users/me/username` -> sortie du stack Auth (status `authenticated`) | 1 min |
| S5  | `ROOM-FEED-001`   | Room-Feed     | Le feed des rooms charge (`GET /rooms`) et affiche au moins une carte                    | 2 min |
| S6  | `ROOM-FEED-005`   | Room-Feed     | "Rejoindre (Join)" -> navigation vers Room                                               | 1 min |
| S7  | `ROOM-LIVE-021`   | Room-Live     | Audio LiveKit passe `connecting` -> `live` (banniere), micro publie                      | 3 min |
| S8  | `ROOM-LIVE-025`   | Room-Live     | Micro Mute/Unmute coupe/retablit la voix (rollback optimiste OK)                         | 2 min |
| S9  | `ROOM-LIVE-029`   | Room-Live     | Lever/Baisser la main (reconciliation `serverHandRaised`)                                | 2 min |
| S10 | `ROOM-LIVE-044`   | Room-Live     | "Quitter" -> goBack + liberation audio meme path                                         | 1 min |
| S11 | `MSG-LIST-002`    | MSG-List      | Ouvrir une conversation 1:1 (la liste charge, badge non-lu)                              | 1 min |
| S12 | `MSG-CHAT-013`    | Chat          | Envoyer un message texte (optimiste + invalidation), pas de doublon                      | 2 min |
| S13 | `NOTIF-007`       | Notifications | Tap notif `room_invite` -> deep-link `Room` (chemin temps-reel coeur)                    | 2 min |
| S14 | `ADM-HOME-001`    | ADM-Home      | (compte admin) Accueil admin charge `GET /admin/stats`, KPI affiches                     | 2 min |
| S15 | `ADM-ROOMS-008`   | ADM-Rooms     | (admin) "Fermer la room" force-end -> participants notifies `room:ended`                 | 2 min |

> **Variante "smoke sans admin"** : si la campagne ne couvre pas de compte admin, remplacer S14/S15 par `HOUSE-DETAIL-009` (Rejoindre une house) et `PROF-VIEW-024` (Follow/Unfollow) pour rester a 15 cas.
>
> **Variante "smoke sans build EAS" (Expo Go)** : S7/S8 deviennent la verification de la banniere `unsupported` (`ROOM-LIVE-023`) — l'app reste fonctionnelle sans voix ; l'audio reel est verifie en campagne EAS.

---

## 3. Regression UI (apres refonte composant)

Declenchee quand un **composant partage de presentation** ou la **navigation** change. On ne reteste pas la logique metier (couverte par §4) — on verifie **rendu, etats visuels, interaction, accessibilite** sur les ecrans consommateurs.

### 3.1 Refonte du composant `Button` (`src/shared/components/Button`)

Le `Button` porte : variants (`primary`/`ghost`/`outline`/`danger`/`primaryContainer`), `loading`, `accessibilityState` (`disabled`/`busy`/`selected`), label + `accessibilityLabel`. Une refonte impacte **chaque CTA de l'app**.

**Echantillon obligatoire** (1 par variant + cas d'etat) :

| Cas (ID)           | Variant / etat verifie                         | Assertion de regression                                                                   |
| ------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `AUTH-UNAME-007`   | primary + `disabled` (regex invalide)          | Bouton grise tant que `!isValid`, `accessibilityState.disabled=true`                      |
| `ROOM-LIVE-040`    | danger (End Room) + confirmation               | Style destructif conserve, Alert de confirmation toujours declenchee                      |
| `ROOM-LIVE-044`    | navigation (Quitter)                           | Label visible `room.leave` + `accessibilityLabel` `room.leaveQuietly` distincts conserves |
| `MSG-CHAT-016`     | submit + `busy` (Envoyer)                      | Spinner `loading` pendant `send.isPending`, pas de double envoi au multi-clic             |
| `HOUSE-DETAIL-009` | primary (Rejoindre) -> etat post               | Transition Rejoindre -> "Invite members" apres succes                                     |
| `PROF-VIEW-026`    | toggle Follow/Following (loading)              | `loading=isPending`, libelle bascule Follow <-> Following                                 |
| `EXT-FOLLOW-002`   | toggle outline (Suivre/Following) + `selected` | `accessibilityState.selected` correct, rollback visuel sur echec                          |
| `ADM-UDET-002`     | danger (Suspendre) + Alert                     | Couleur danger + dialogue de confirmation natif intacts                                   |
| `SET-MAIN-020`     | danger (Delete account)                        | Style + Alert destructive preserves                                                       |

**Assertions transverses Button** (a verifier sur l'echantillon, cf. `05-accessibilite.md`) :

- Cible tactile **>= 44x44** (hitSlop inclus) sur tous les variants.
- `accessibilityRole="button"` present ; `accessibilityState` (disabled/busy/selected) propage.
- Label visible **et** `accessibilityLabel` (quand distinct) tous deux corrects en **FR et EN**.
- Etat `loading` : non re-cliquable (anti multi-clic), spinner annonce comme `busy`.
- Police XXL : pas de troncature du label, pas de chevauchement.

### 3.2 Refonte du composant `Input` (`src/shared/components/Input`)

L'`Input` porte : `label`, `placeholder`, `helper` (compteur `len/max`), `leftAdornment`/`adornment` (`@`, icone search), `maxLength`, `multiline`, `autoCapitalize`/`autoCorrect`, etats erreur.

**Echantillon obligatoire** :

| Cas (ID)          | Specificite verifiee                     | Assertion de regression                                            |
| ----------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| `AUTH-PHONE-005`  | `placeholder` + selecteur pays adjacent  | Placeholder `+33 6 12 34 56 78`, layout avec le drapeau intact     |
| `AUTH-UNAME-001`  | adornment `@` + helper `len/24`          | `@` affiche, compteur `len / 24` mis a jour a la frappe            |
| `PROF-EDIT-006`   | `helper` compteur `len/40` + `maxLength` | Compteur exact, blocage a `maxLength`, `getByDisplayValue` correct |
| `PROF-EDIT-008`   | `multiline` Bio + `maxLength=150`        | Multiline rendu, compteur `len/150`, scroll interne                |
| `SEARCH-002`      | `leftAdornment` icone search + debounce  | Icone presente, debounce 200 ms non casse (1 seul GET)             |
| `MSG-CHAT-011`    | champ message + `onChangeText` (typing)  | Saisie declenche `chat:typing` (throttle 2,5 s), placeholder OK    |
| `ROOM-CREATE-002` | placeholder long + validation longueur   | Placeholder `De quoi veux-tu parler ?`, garde 3-80                 |
| `AUTH-NAME-002`   | label + `autoCapitalize=words`           | Label `Prenom`, capitalisation des mots active                     |

**Assertions transverses Input** :

- `placeholder` **et** `label` traduits FR/EN ; `accessibilityLabel`/role corrects.
- `helper` compteur exact et reactif ; `maxLength` respecte.
- Adornments (`@`, icones) positionnes sans recouvrir le texte.
- `keyboardType`/`autoComplete`/`textContentType` preserves (ex. OTP `one-time-code`, phone `phone-pad`).
- Focus/blur, clavier qui ne masque pas le champ (KeyboardAvoidingView), police XXL.

### 3.3 Refonte du theme / tokens (`src/core/theme`)

Theme **mono-dark assume** (cf. memoire). Une refonte de tokens (couleurs, espacements, typo) impacte le rendu global. On ne rejoue pas la logique : on **echantillonne le rendu visuel + contraste** sur 1 ecran par famille.

| Cas (ID)                     | Famille                                     | Verif                                                                  |
| ---------------------------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| `ROOM-LIVE-003`              | rooms (dense, badges, ring vert speaking)   | Contrastes, ring vert "is speaking" visible, badges lisibles           |
| `MSG-CHAT-038`               | messages (bulles in/out, vocal)             | Bulles emetteur/recepteur distinctes, lisibilite                       |
| `ADM-HOME` (echantillon KPI) | admin (KPI, badges)                         | Badges `reports.open`/`rooms.live` contrastes                          |
| `EXT-SET-001`                | extensions (segments theme Auto/Light/Dark) | Segment selectionne visible (le toggle theme existe meme en mono-dark) |
| `PROF-VIEW-006`              | profil (bio voir plus, liens)               | Liens sociaux contrastes, role link conserve                           |
| `AUTH-LAND-001`              | auth (animations d'entree)                  | Animations reanimated non cassees, CTA lisibles                        |

**Assertions theme** (cf. `05-accessibilite.md`) :

- Contraste texte/fond **>= 4.5:1** (texte normal), **>= 3:1** (gros texte/icones).
- Etats `selected`/`disabled`/`error` toujours distinguables **sans la couleur seule** (icone/forme).
- Pas de cle i18n brute affichee suite a un re-layout.
- Mode contraste eleve OS : pas d'element invisible.

### 3.4 Refonte navigation (`src/core/navigation`, `linking`, headers, `AdminHeader`)

Impacte retours, tab-bar, deep-links, `replace`/`popToTop`, badges d'onglet.

| Cas (ID)           | Element                                          | Verif de regression                                                 |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------- |
| `AUTH-OTP-001`     | Retour header (`common.close`)                   | `goBack` une fois, pas de double-pop                                |
| `AUTH-OTP-002`     | Retour multi-clic                                | Pas d'empilement / pile vide / crash                                |
| `ROOM-CREATE-021`  | `navigation.replace('Room')` apres creation      | Pas de retour vers Create (replace, pas push)                       |
| `MSG-NEW-016`      | `replace('ChatDetail')` / `replace('GroupChat')` | Bon ecran cible selon 1 vs >=2 selectionnes                         |
| `ADM-UDET-018`     | `popToTop()` apres usurpation                    | Pile reinitialisee, requetes suivantes au nom de la cible           |
| `MSG-GINFO-005`    | `popToTop` apres "Quitter le groupe" (onSettled) | Depart meme si le leave reseau echoue                               |
| `NOTIF-007`        | Deep-link notif -> `Room`                        | `navigate('Room',{roomId})` correct                                 |
| `HOUSE-DETAIL-001` | Retour + deep-link `house/:id/invite/:token`     | Token jamais logge, ecran Invitation atteint                        |
| `ROOM-FEED-016`    | Badge non-lu onglet Notifications                | Badge `{n} unread` rendu, alimente par `useUnreadNotificationCount` |
| `SET-MAIN-008`     | Tab-bar / "More options"                         | Navigation principale + feuille d'options intacte                   |

**Assertions navigation** :

- Tous les **deep-links** de `linking.ts` (`room/:roomId`, `house/:houseId/invite/:inviteToken?`, `invite/<code>`, `chat/:conversationId`) resolvent vers le bon ecran ; **token d'invitation jamais logge**.
- `replace` vs `push` respecte (pas de retour vers une room/groupe deja cree).
- Multi-clic rapide sur tout bouton de navigation = **une seule** navigation (R4).
- Gating de role : un USER ne voit pas les routes admin (R11).
- Safe-areas / encoches / Dynamic Island : header non masque.

---

## 4. Regression BACKEND (apres changement API / WebSocket)

Declenchee par un changement de **contrat REST** (route, payload, code d'erreur) ou d'**evenement WebSocket**. On verifie que l'app **consomme** correctement le nouveau contrat : parsing, etats vides/erreur, optimisme + rollback, invalidation de cache.

> **Pre-check obligatoire** avant toute regression backend : `.env` racine pointe la bonne IP LAN (perime au changement de reseau), Expo redemarre apres edition, `:4000` joignable, delta compteur `/metrics` confirme que les requetes partent (cf. R9).

### 4.1 AUTH (`/auth/send-otp`, `/auth/verify-otp`, refresh token, intercepteur axios)

Impact **transversal** : un changement de l'intercepteur (refresh/401) impacte **toute** session.

| Cas (ID)         | Scenario de regression                                                      | Assertion                                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH-PHONE-009` | `POST /auth/send-otp` succes                                                | OTP envoye, navigation vers OTP avec `phoneNumber`                                                                                                        |
| `AUTH-PHONE-014` | send-otp **rate-limit / erreur serveur**                                    | Message d'erreur correct, pas de navigation, pas de crash                                                                                                 |
| `AUTH-OTP-004`   | `POST /auth/verify-otp` succes nouvel utilisateur                           | Route vers `Name` (nouveau)                                                                                                                               |
| `AUTH-OTP-006`   | verify-otp succes utilisateur **existant**                                  | Promotion directe `authenticated`                                                                                                                         |
| `AUTH-OTP-008`   | code faux -> `attemptsRemaining`, shake, champ vide                         | Compteur de tentatives expose par le backend respecte (MAX 5)                                                                                             |
| `AUTH-OTP-010`   | 5 echecs -> `locked`                                                        | Soumissions bloquees client jusqu'au renvoi                                                                                                               |
| `AUTH-OTP-005`   | verify-otp **hors-ligne**                                                   | Message generique invalide (le code ne distingue pas reseau vs faux)                                                                                      |
| `AUTH-LAND-010`  | dev-skip `devLogin()` -> token persiste + `registerWithBackend` best-effort | Token stocke, push best-effort (no-op silencieux possible)                                                                                                |
| **Transverse**   | **Token expire en cours de session** (R/410 sur n'importe quel ecran)       | L'intercepteur refresh **ne deconnecte pas** sur blip reseau (cf. commit `86cca8a`), reessaie ; deconnexion seulement sur refresh definitivement invalide |

> **Regression critique intercepteur** : apres tout changement du flux refresh, rejouer un parcours long (Feed -> Room -> Chat) avec **token volontairement expire** mid-session et **coupure reseau** : verifier qu'on ne se fait pas ejecter sur un simple blip (regression historique connue).

### 4.2 FEED rooms (`/rooms`, `/explore`, `/rooms/:id`, `/rooms/:id/rsvp`, `/rooms/events/mine`)

| Cas (ID)                | Scenario                                                   | Assertion                                                                          |
| ----------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `ROOM-FEED-001`         | `GET /rooms` (filtre All) charge                           | Cartes rendues, `keepPreviousData` (pas de flash skeleton au changement de filtre) |
| `ROOM-FEED-009` a `015` | Pills filtres (Following/Clubs/Tech/Music/Business/Health) | Chaque filtre change la queryKey et refetch ; pas de melange de resultats          |
| `ROOM-FEED-003`         | `GET /rooms` **vide**                                      | EmptyState correct                                                                 |
| `ROOM-FEED-004`         | `GET /rooms` **erreur/hors-ligne**                         | Etat erreur, pull-to-refresh fonctionnel                                           |
| `SEARCH-005`            | `GET /search?q=&type=all`                                  | Resultats Room/Club/User parses, enabled si `q.trim>0`, debounce 200 ms            |
| `SEARCH-002`            | `GET /explore` feed                                        | Feed charge, pull-to-refresh `explore.refetch`                                     |
| `EVT-004`               | `POST/DELETE /rooms/:id/rsvp` -> invalidation `['events']` | `attendeeCount` mis a jour apres refetch                                           |
| `ROOM-CREATE-021`       | `POST /rooms` (instantanee)                                | `replace('Room')`, invalidation `roomKeys.list`                                    |
| `ROOM-CREATE-028`       | `POST /rooms` (scheduled)                                  | `goBack`, room non-live, feed invalide                                             |
| `HOUSE-DETAIL-018`      | `GET /rooms?clubId=&filter=` (sections live/planifiees)    | Rooms de la house apparaissent apres refetch                                       |

**Assertions FEED** : forme du DTO room (id, title, hostId, participantCount, scheduledFor, visibility) parsee sans crash ; gating visibilite Social applique cote backend respecte cote UI ; codes d'erreur mappes a un message i18n.

### 4.3 MESSAGES (`/conversations`, `/messages`, `/groups/*`, `/voice`)

| Cas (ID)         | Scenario                                              | Assertion                                                |
| ---------------- | ----------------------------------------------------- | -------------------------------------------------------- |
| `MSG-LIST-001`   | `GET` conversations + groupes                         | Liste 1:1 + section groupes rendue                       |
| `MSG-CHAT-013`   | Envoi texte (POST) injection optimiste + invalidation | Pas de doublon, ordre conserve, reconciliation serveur   |
| `MSG-CHAT-020`   | Envoi **vocal** (`voiceService.upload` -> POST)       | Upload puis message vocal, lecture inline expo-audio     |
| `MSG-CHAT-024`   | Marquage lu auto a l'ouverture (`markedRef` une fois) | Badge onglet decremente, une seule fois                  |
| `MSG-GCHAT-005`  | `POST /groups/:id/messages` + `setQueryData`          | Ajout en fin de liste, invalidation list                 |
| `MSG-GINFO-002`  | `PATCH /groups/:id` (renommer)                        | Invalidation detail+list, propagation apres refetch      |
| `MSG-GINFO-004`  | `DELETE /groups/:id/members/:userId` (retirer)        | Membre retire perd l'acces                               |
| `MSG-GINFO-005`  | `POST /groups/:id/leave` (onSettled popToTop)         | Depart meme si echec reseau                              |
| `MSG-ADDGRP-005` | `POST /groups/:id/members` (Ajouter N)                | Idempotence (pas de doublon), invalidation detail+list   |
| `MSG-NEW-016`    | `POST /groups` (>=2) puis `replace('GroupChat')`      | Groupe cree, invalidation `groupKeys.list` cote createur |

**Assertions MESSAGES** : DTO message (texte/vocal, senderId, timestamp, fileUrl) parse ; `unreadCount` coherent ; rollback si POST echoue ; **dedup backend** des ajouts concurrents.

### 4.4 MODERATION / ADMIN (`/admin/*`, `/rooms/:id/force-end`, kick, role, push)

| Cas (ID)            | Scenario                                                  | Assertion                                                                 |
| ------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| `ADM-HOME-001`      | `GET /admin/stats` (poll 30 s)                            | KPI + badges `reports.open`/`rooms.live` rafraichis a 30 s                |
| `ADM-HOME` whoami   | `GET /admin/me` (`appRole`)                               | Tuiles/exports visibles selon role (ADMIN vs SUPER_ADMIN, R11)            |
| `ADM-USERS-008`     | `GET /admin/users` curseur 50 + recherche debounce 250 ms | Pagination, `q` omis si vide, cle indexee `{q,role,limit}`                |
| `ADM-UDET-002..005` | `POST` suspend (1h/24h/7j/perm)                           | Cible perd l'acces a la prochaine requete, invalidation fiche+liste       |
| `ADM-UDET-007..010` | `setRole` USER/MOD/ADMIN/SUPER                            | Changement de role propage, audit log ecrit                               |
| `ADM-UDET-018`      | Usurpation (`impersonationStore.start`)                   | Token injecte dans axios, `popToTop`, action **journalisee**              |
| `ADM-REP-005`       | `POST /admin/reports/:id/resolve`                         | Invalidation `['admin','reports']` + stats                                |
| `ADM-ROOMS-008`     | `POST /admin/rooms/:id/force-end`                         | Participants notifies + canal LiveKit ferme (verif cross-device, voir §5) |
| `ADM-AUDIT-002`     | `GET /admin/audit-log` pull-to-refresh                    | Nouvelles entrees apparaissent apres refresh (pas de live)                |

**Assertions ADMIN** : **gating de role strict** (un USER n'atteint aucune route admin) ; audit log ecrit pour chaque action destructive ; codes d'erreur 403/409 mappes ; **force-end** doit declencher l'effet temps-reel cote participants (chainage avec §5.2).

---

## 5. Regression temps-reel (reconnexion, sync)

Declenchee par tout changement touchant **WebSocket** (`getSocket()`, hooks `useRoomSocket`/`useChatSocket`/`useGroupSocket`/`useHallwaySocket`/`useExtSocketAliases`/`maps`), **LiveKit** (`useRoomAudio`), ou la **gestion de reconnexion**. **A jouer obligatoirement a 2-3 devices** (A = host/emetteur, B = participant/recepteur, C = 3e observateur).

> Risques cibles : R1 (events manques/doublons/desync), R2 (reseau instable + rollback optimiste), R3 (audio natif, hot-unmute apres reconnect), R4 (race/throttle/caps).

### 5.1 Reconnexion socket & survie d'etat

| Cas (ID)        | Scenario multi-device                                                   | Assertion de regression                                                                                                         |
| --------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ROOM-LIVE-011` | Force-mute par host A -> B `room:mute-changed`                          | B passe muet ; **le mute survit a une coupure/reconnexion** de B (restaure depuis `currentRoomStore`, **pas de hot-unmute** R3) |
| `ROOM-LIVE-029` | B leve la main, coupe le reseau 10 s, reconnecte                        | Etat main reconcilie sur `serverHandRaised` (pas de main fantome)                                                               |
| `ROOM-LIVE-021` | Audio `connecting` -> `live` ; couper mid-call                          | Banniere passe `reconnecting` puis `live` ; audio restaure ; mute conserve                                                      |
| `MSG-LIST-004`  | B recoit `chat:message` socket pendant que A envoie                     | Liste reordonnee + badge non-lu **live** sans pull-to-refresh                                                                   |
| `MSG-CHAT-011`  | A tape -> B voit "ecrit…" (TTL 4 s), A s'arrete                         | Sous-titre repasse a `@username` apres 4 s ; throttle sortant 2,5 s                                                             |
| `NOTIF-018`     | A genere une notif -> B `notification:new` + `notification:count`       | FlatList rafraichie sans polling, **badge tab-bar instantane** (creation/mark-read/mark-all)                                    |
| `ROOM-FEED-002` | A cree une room -> B `hallway:room_created`                             | Feed de B refetch (invalidation `roomKeys.list`), pas de pull manuel                                                            |
| `EXT-FEED-006`  | Live-prepend `room_started` / `join_request` / `ping_user` selon onglet | Entree `live-` non persistee, dedup au fetch, cap `MAX_ITEMS=200`                                                               |

### 5.2 Synchronisation multi-utilisateur (verite serveur)

| Cas (ID)        | Scenario                                                                     | Assertion                                                                                         |
| --------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `ROOM-LIVE-031` | A promeut B (`room:role_changed` SPEAKER)                                    | B revele le micro (`forceSpeaker`), haptique, alerte "On stage"                                   |
| `ROOM-LIVE-033` | A retrograde B (LISTENER)                                                    | B nettoie `isMuted`/`isHandRaised`, alerte "Moved to audience"                                    |
| `ROOM-LIVE-013` | A kick B (`room:user_kicked` + `room:you_were_kicked`)                       | B `goBack` + Alert removed, **RoomBan 30 min** applique                                           |
| `ROOM-LIVE-015` | A (host) ferme la room (`room:ended`)                                        | Tous B/C `goBack` + Alert "Room ended" ; host filtre via `viewerIsHostRef` (pas de double goBack) |
| `ADM-ROOMS-008` | Admin force-end (REST) -> participants                                       | Effet identique `room:ended` cote participants, liste live invalide cote admin                    |
| `ROOM-LIVE-046` | A envoie reaction (`room:reaction`)                                          | B voit le float emoji ; **echo propre filtre** (`user_id === viewerId` ne re-affiche pas chez A)  |
| `MAP-018`       | A bouge -> B `maps:user-moved` ; A passe offline -> `maps:user-offline`      | Pin relocalise / retire du roster ; Ghost Mode coupe l'emission                                   |
| `MSG-GCHAT-004` | A ajoute un membre -> autres membres via `group:message`/socket conversation | Mise a jour d'appartenance live cote membres existants                                            |

### 5.3 Race conditions, throttles, caps

| Cas (ID)        | Scenario                             | Assertion                                                                     |
| --------------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| `ROOM-LIVE-046` | Spam reactions A                     | Throttle **250 ms**, floats plafonnes a **24** (`MAX_FLOATS`)                 |
| `ROOM-LIVE-010` | Room avec > 50 auditeurs "Autres"    | Cap `OTHERS_DISPLAY_CAP=50` + pastille "+N"                                   |
| `MSG-CHAT-016`  | Multi-clic Envoyer x5                | Un seul message envoye (anti double-envoi)                                    |
| `ROOM-LIVE-025` | Mute/Unmute tres rapide + echec REST | Rollback optimiste **3 niveaux** (UI + store + LiveKit), pas d'etat divergent |
| `ROOM-FEED-005` | Double-tap Join                      | Une seule navigation/connexion (pas de double-join)                           |
| `MAP-024`       | Double-tap Join Room depuis la carte | Pas de double-join LiveKit                                                    |

### 5.4 Audio LiveKit / build & degradation

| Cas (ID)           | Scenario                                              | Assertion                                                                                  |
| ------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `ROOM-LIVE-023`    | App sous **Expo Go** (module natif absent)            | Banniere `unsupported`, app **reste fonctionnelle** sans voix (cf. commit `08ad383`)       |
| `ROOM-LIVE-021`    | Permission micro **refusee / revoquee a chaud**       | Pas de crash ; statut audio coherent ; demande de permission geree                         |
| `ROOM-LIVE-022`    | Scores "is speaking" temps-reel                       | Ring vert + badge `graphic-eq` sur la cellule de l'orateur actif                           |
| `EXT-SET-004..006` | Changement qualite audio (Standard/Elevee/Musique)    | PATCH `/ext/audio` optimiste, effet differe sur le pipeline LiveKit en room (pas immediat) |
| `ROOM-REPLAY-002`  | Play/Pause replay (`expo-audio`, `playsInSilentMode`) | Streaming OK, audible en mode silencieux iOS, robuste au multi-clic                        |

> **Procedure de coupure reseau** (R2/R3) : mode avion 5-10 s puis retour ; bridage 3G ; coupure Wi-Fi mid-call. A chaque retour : verifier reconnexion socket **sans listener fantome** (les hooks nettoient via `socket.off` + flag `cancelled` au logout/demontage) et **survie du mute**.

---

## 6. Table de tracabilite changement -> cas

Lecture : pour un type de changement (colonne 1), lancer les cas listes (colonne 3) plus **toujours** la SMOKE (§2). La colonne "Suite" renvoie a la section detaillee.

| Changement (zone de code)                         | Cercles     | Cas / suites a rejouer                                                                                                                                  | Suite       |
| ------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `Button` (composant partage)                      | C2          | `AUTH-UNAME-007`, `ROOM-LIVE-040/044`, `MSG-CHAT-016`, `HOUSE-DETAIL-009`, `PROF-VIEW-026`, `EXT-FOLLOW-002`, `ADM-UDET-002`, `SET-MAIN-020` + SMOKE    | §3.1        |
| `Input` (composant partage)                       | C2          | `AUTH-PHONE-005`, `AUTH-UNAME-001`, `PROF-EDIT-006/008`, `SEARCH-002`, `MSG-CHAT-011`, `ROOM-CREATE-002`, `AUTH-NAME-002`                               | §3.2        |
| `OtpInput`                                        | C1          | `AUTH-OTP-*` (13 cas)                                                                                                                                   | §3.2 + `09` |
| Theme / tokens                                    | C2          | `ROOM-LIVE-003`, `MSG-CHAT-038`, `ADM-HOME` (KPI), `EXT-SET-001`, `PROF-VIEW-006`, `AUTH-LAND-001` + audit contraste `05-accessibilite.md`              | §3.3        |
| Navigation / linking / headers                    | C2+C3       | `AUTH-OTP-001/002`, `ROOM-CREATE-021`, `MSG-NEW-016`, `ADM-UDET-018`, `MSG-GINFO-005`, `NOTIF-007`, `HOUSE-DETAIL-001`, `ROOM-FEED-016`, `SET-MAIN-008` | §3.4        |
| API AUTH / intercepteur token                     | C3 (global) | `AUTH-PHONE-009/014`, `AUTH-OTP-004/005/006/008/010`, `AUTH-LAND-010` + **parcours token-expire mid-session** + SMOKE complet                           | §4.1        |
| API FEED rooms                                    | C3          | `ROOM-FEED-001/003/004/009..015`, `SEARCH-002/005`, `EVT-004`, `ROOM-CREATE-021/028`, `HOUSE-DETAIL-018`                                                | §4.2        |
| API MESSAGES / voice                              | C3          | `MSG-LIST-001`, `MSG-CHAT-013/020/024`, `MSG-GCHAT-005`, `MSG-GINFO-002/004/005`, `MSG-ADDGRP-005`, `MSG-NEW-016`                                       | §4.3        |
| API ADMIN / moderation / force-end                | C3          | `ADM-HOME-001`, `ADM-USERS-008`, `ADM-UDET-002..010/018`, `ADM-REP-005`, `ADM-ROOMS-008`, `ADM-AUDIT-002`                                               | §4.4        |
| WS room:\* (mute/role/kicked/ended/reaction)      | C3          | `ROOM-LIVE-011/013/015/031/033/046` (2-3 devices)                                                                                                       | §5.1, §5.2  |
| WS chat:_ / group:_                               | C3          | `MSG-LIST-004`, `MSG-CHAT-011`, `MSG-GCHAT-004`                                                                                                         | §5.1, §5.2  |
| WS notification:\*                                | C3          | `NOTIF-007/018`                                                                                                                                         | §5.1        |
| WS hallway:\*                                     | C3          | `ROOM-FEED-002`                                                                                                                                         | §5.1        |
| WS maps:\*                                        | C3          | `MAP-018/024`                                                                                                                                           | §5.2, §5.3  |
| WS extensions (aliases)                           | C3          | `EXT-FEED-006`                                                                                                                                          | §5.1        |
| Pipeline LiveKit / `useRoomAudio` / mute          | C1+C3       | `ROOM-LIVE-011/021/022/023/025`, `EXT-SET-004..006`, `ROOM-REPLAY-002`                                                                                  | §5.4        |
| Reconnexion / gestion socket (off/cleanup)        | C3          | `ROOM-LIVE-011/021/029`, `MSG-LIST-004`, `NOTIF-018` + **procedure coupure reseau**                                                                     | §5.1, §5.4  |
| Push (`pushService`, `/push/register`, deep-link) | C3          | `NOTIF-007`, `ONB-PERM-001`, `AUTH-LAND-010`, `HOUSE-INVITE-*` (CLUB_INVITE), `ROOM-INVITE-004`                                                         | §4.4, R12   |
| Cache React Query (cles partagees)                | C2          | 1 cas par feature consommatrice de la cle invalidee (cf. `rt[]` de chaque ecran)                                                                        | §4 ciblee   |

### 6.1 Convention de reference des cas

- **Prefixe = token du fichier ecran** (sans le numero) : `01-ADM-AUDIT.md` -> `ADM-AUDIT-NNN`, `47-ROOM-LIVE.md` -> `ROOM-LIVE-NNN`, `31-NOTIF.md` -> `NOTIF-NNN`.
- **NNN** = numero du cas dans le fichier ecran (3 chiffres, sequentiel). Les numeros cites ici designent le **bouton/scenario** correspondant ; si la numerotation locale a evolue depuis cette redaction, se referer au **libelle du controle** dans la matrice bouton de l'ecran (`01-matrice-ecran-bouton.md` / fichier ecran) qui fait foi.
- En cas de doute sur l'existence d'un numero, le **controle** (nom de bouton + locator) est l'ancre stable : tous les controles cites existent dans les matrices des fichiers ecran.

### 6.2 Definition of Done d'une campagne de regression

- [ ] Pre-check environnement OK (`:4000` joignable, `.env` IP correcte, delta `/metrics`).
- [ ] **SMOKE (§2) verte** (15/15) sur 1 Android + 1 iOS, build EAS dev-client.
- [ ] Cercles d'impact (§1) deroules ; suites concernees (§3/§4/§5) jouees.
- [ ] **100 % des P0** des ecrans impactes verts ; **P1** verts ou ticketes.
- [ ] Regression temps-reel jouee **a 2-3 devices** si du WebSocket/LiveKit est touche.
- [ ] Bascule **FR/EN** verifiee sur les ecrans UI impactes (R10).
- [ ] Aucun token d'invitation logge (R-securite) ; gating de role verifie (R11).
- [ ] Resultats consignes (cas, OK/KO, device, OS, build) ; KO -> ticket avec ID de cas.
