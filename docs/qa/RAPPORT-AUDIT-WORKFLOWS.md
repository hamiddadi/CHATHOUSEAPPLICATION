# Rapport d'audit QA — Intégrité des workflows ChatHouse

|                  |                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Date**         | 2026-06-11                                                                                                                                                               |
| **Périmètre**    | 10 machines à états (workflows) du backend ChatHouse                                                                                                                     |
| **Méthode**      | Audit statique multi-agents (cartographie → chasse aux anomalies adversariale → vérification de chaque anomalie par relecture du code) + tests de régression automatisés |
| **Base auditée** | `backend/src/` (Node/Express + Prisma/PostgreSQL + Socket.IO + Redis/BullMQ + LiveKit + Stripe), branche `main`                                                          |
| **Code modifié** | Aucun (audit en lecture seule). Seuls ajouts : ce rapport + tests dans [backend/tests/workflows/](../../backend/tests/workflows/)                                        |

---

## ⚠️ Note de périmètre (lis-moi en premier)

Le brief initial décrivait un outil de **gestion de tickets type Shortcut/Clubhouse.io** (états `Backlog → À faire → En cours → En revue → Terminé`). **Ce système n'existe pas dans ce dépôt.**

ChatHouse est une **application audio-sociale de type Clubhouse** (rooms vocales, speakers, clubs, follow). Après validation, l'audit a porté sur les **vraies machines à états** de l'application, qui correspondent exactement à l'intention du brief (états, transitions autorisées, gardes/règles, effets de bord automatiques) — voir la cartographie en §2.

---

## 1. Résumé exécutif

10 workflows cartographiés et testés. **81 anomalies candidates détectées → 79 confirmées après vérification adversariale, 2 rejetées.**

| Criticité          | Nombre | Signification                                                                                       |
| ------------------ | -----: | --------------------------------------------------------------------------------------------------- |
| 🔴 **Bloquante**   |  **1** | Perte d'argent + boucle de panne irréversible                                                       |
| 🟠 **Majeure**     | **27** | Faille de sécurité/RBAC, contournement de garde métier, désync de données, fuite de confidentialité |
| 🟡 **Mineure**     | **51** | Idempotence/concurrence, effets de bord secondaires, incohérences UX/données non critiques          |
| **Total confirmé** | **79** |                                                                                                     |

### Thèmes dominants (où ça casse)

1. **Double chemin d'écriture non synchronisé.** Le module _legacy_ (`rooms.service`, `clubs.service`) et les _extensions_ (`speakInvite`, `clubreq`) écrivent le même état avec des gardes différentes. Les extensions court-circuitent presque systématiquement les protections du legacy (capacité, RBAC, état de la room). → PART-02/03/04, HAND-02/03/04, CLUB-01.
2. **Protection du HOST incohérente.** `kick` et `setMute` protègent le host (ROOM_009/ROOM_003) mais `setRole` ne le protège pas pour `LISTENER`/`SPEAKER` → un modérateur peut museler/rétrograder le host. → ROOM-01, PART-01.
3. **Cycle de suppression de compte (RGPD) non étanche.** La purge hard-delete l'utilisateur sans annuler Stripe (facturation fantôme), sans purger Redis (boucle webhook), et détruit la piste d'audit. → 🔴 PAYM-03, PAYM-04/05, MODE-01.
4. **Transitions non atomiques.** Quasi toutes les transitions sensibles (OTP, refresh-token, follow, force-end, resolveReport, go-live/cancel) sont des _read-then-write_ sans transaction/garde conditionnelle → doubles exécutions sous concurrence. → OTP-01, AUTH-02, ROOM-04/05, EVEN-03, MODE-04/05.
5. **Gardes de confidentialité/blocage non appliquées au point d'écriture.** Follow ignore le graphe de blocage et le flag privé ; les replays de rooms privées sont servis à tous. → FOLL-01/02, RECO-02.

---

## 2. Cartographie des workflows

> Notation : `→` transition ; `‹trigger›` ce qui la déclenche ; _RBAC_ = qui a le droit. Réf. = `fichier:ligne`.

### 2.1 — Cycle de vie de la Room

**États :** `SCHEDULED` (isLive=false, scheduledFor futur) · `LIVE` (isLive=true) · `ENDED` (endedAt set, irréversible → ROOM_004). Orthogonaux : RoomType `OPEN/SOCIAL/CLOSED` (immuable), `isPrivate`, chatVisibility `ALL/MODS_ONLY`, RoomBan actif/expiré.

| De → Vers                       | Trigger                                                               | RBAC                                    |
| ------------------------------- | --------------------------------------------------------------------- | --------------------------------------- |
| ∅ → SCHEDULED                   | `POST /api/rooms` + scheduledFor                                      | Authentifié non suspendu (devient host) |
| ∅ → LIVE                        | `POST /api/rooms` sans scheduledFor                                   | Authentifié non suspendu (devient host) |
| SCHEDULED → LIVE                | Job BullMQ `go-live` à T-0                                            | Système (worker)                        |
| LIVE → ENDED                    | `POST /api/rooms/:id/end`, `DELETE /api/rooms/:id`, socket `room:end` | **HOST uniquement** (pas les mods)      |
| LIVE → ENDED                    | Auto-close : host part, aucun successeur ni participant               | Auto (départ host)                      |
| LIVE/SCHEDULED → ENDED          | `POST /api/admin/rooms/:id/force-end`                                 | appRole ≥ ADMIN + GODMODE               |
| LIVE(host) → LIVE(nouveau host) | Auto-succession au départ du host                                     | Auto                                    |
| LIVE(role X) → LIVE(role Y)     | `PATCH /api/rooms/:id/role`                                           | HOST/MOD (HOST & MOD réservés au host)  |
| join / leave / kick / rsvp      | endpoints dédiés                                                      | self / host-mod selon                   |

**Effets de bord (29)** : emit `hallway:room_created/closed/updated`, `room:ended`, `room:role_changed` ; notifications ROOM_INVITE/ROOM_STARTED/HAND_ACCEPTED/ROOM_ENDED_BY_ADMIN ; jobs BullMQ `remind`/`go-live` + `cancelEventReminder` ; `recordingsService.start/stopForRoom` ; `closeSfuRoom` ; AuditLog ROOM_FORCE_ENDED. Réf. [rooms.service.ts](../../backend/src/modules/rooms/rooms.service.ts), [admin.service.ts:436](../../backend/src/modules/admin/admin.service.ts#L436).

### 2.2 — Rôles participant

**États :** `Role` = LISTENER / SPEAKER / MODERATOR / HOST (sur `Participant.role`, host doublé par `Room.hostId`) · présence ACTIF/PARTI (`leftAt`) · audio `isMuted` · RoomBan · SpeakInvite PENDING/NONE (Redis TTL 5 min) · HandRaise RAISED/NONE. Le droit de publier l'audio est dérivé du rôle via `canPublishInRoom` (HOST/MOD/SPEAKER). Réf. [roomAuthz.ts:23](../../backend/src/webrtc/roomAuthz.ts#L23).

| De → Vers                         | Trigger                                                 | RBAC                                        |
| --------------------------------- | ------------------------------------------------------- | ------------------------------------------- |
| LISTENER → SPEAKER                | `PATCH /role {SPEAKER}` (tx Serializable + maxSpeakers) | HOST/MOD                                    |
| SpeakInvite PENDING → SPEAKER     | `POST /api/ext/speak-invite/:room/respond {accepted}`   | l'invité (⚠ aucune garde room/capacité)     |
| LISTENER/SPEAKER → MODERATOR      | `PATCH /role {MODERATOR}`                               | **HOST seul** (garde :539)                  |
| LISTENER/SPEAKER → MODERATOR      | `POST /api/ext/speak-invite/:room/promote/:user`        | HOST/MOD ⚠ (incohérent, voir PART-02)       |
| → LISTENER / SPEAKER              | `PATCH /role`                                           | HOST/MOD (⚠ host non protégé, voir PART-01) |
| transfert HOST                    | `PATCH /role {HOST}`                                    | HOST seul                                   |
| mute/unmute / mute-all / kick+ban | endpoints dédiés                                        | self ou HOST/MOD                            |

**Effets (19)** : `room:role_changed`, `room:hand_lowered`, HAND_ACCEPTED, SPEAKER_REQUEST, `room:user_kicked`/`you_were_kicked` + socketsLeave + RoomBan upsert, mediasoup `closeProducersForUserInRoom`.

### 2.3 — Lever la main (raise-hand)

**États :** statut implicite = présence/absence d'une ligne `RoomHandRaise` (file FIFO par `raisedAt`) + `Participant.role`. Pas de statut "accepted" stocké : « accepter » = `setRole(SPEAKER)` qui supprime la ligne. Workflow parallèle distinct : speakInvite (host-initié, Redis TTL 5 min).

| De → Vers                  | Trigger                                            | RBAC                     |
| -------------------------- | -------------------------------------------------- | ------------------------ |
| NOT_RAISED → RAISED        | `POST /api/rooms/:id/raise-hand`                   | participant actif        |
| NOT_RAISED → (éphémère)    | socket `room:request-speak` (⚠ ne persiste rien)   | participant actif        |
| RAISED → NOT_RAISED        | `DELETE /raise-hand` (self) ; ou promote ; ou kick | self / HOST-MOD indirect |
| RAISED(LISTENER) → SPEAKER | `PATCH /role {SPEAKER}` (pop file)                 | HOST/MOD                 |

**Effets (14)** : `room:hand_raised/lowered`, HAND_ACCEPTED + push, purge `RoomHandRaise`. ⚠ Le chemin speakInvite ne purge pas la file et n'émet pas `room:role_changed` (HAND-04).

### 2.4 — Follow / demande de suivi

**États :** `NOT_FOLLOWING` ↔ `FOLLOWING` (1 ligne `Follow`, **aucun champ status**) · `BLOCKED` (Block, rupture symétrique). ⚠ **L'état `PENDING` (demande de suivi) n'existe pas** : pas de colonne status sur `Follow`, pas de modèle `FollowRequest`, pas de type de notif dédié (FOLL-01).

| De → Vers                     | Trigger                      | RBAC                                       |
| ----------------------------- | ---------------------------- | ------------------------------------------ |
| NOT_FOLLOWING → FOLLOWING     | `POST /api/follow/:userId`   | authentifié (⚠ pas de garde privé/blocage) |
| FOLLOWING → NOT_FOLLOWING     | `DELETE /api/follow/:userId` | self                                       |
| \* → BLOCKED (+ break follow) | `POST /api/users/:id/block`  | self                                       |

**Effets (10)** : compteurs followerCount/followingCount (⚠ non décrémentés au block, FOLL-03), `user:follower_count`, NEW_FOLLOWER (⚠ jamais retirée à l'unfollow). Fanout ROOM_STARTED (queue, déclenché par la création de room, pas par follow).

### 2.5 — Adhésion Club/House

**États :** NON_MEMBER · INVITED (notif CLUB_INVITE virtuelle) · PENDING_REQUEST (SOCIAL, clé Redis) · MEMBER · MODERATOR · ADMIN · OWNER · CLUB_DELETED. Deux chemins : core `/api/clubs` et extension `/api/ext/clubreq` (qui ajoute la garde d'approbation SOCIAL).

| De → Vers                         | Trigger                                      | RBAC                                                   |
| --------------------------------- | -------------------------------------------- | ------------------------------------------------------ |
| ∅ → OWNER (+ADMIN)                | `POST /api/clubs`                            | authentifié                                            |
| NON_MEMBER → MEMBER               | `POST /api/clubs/:id/join`                   | authentifié (⚠ SOCIAL passe sans approbation, CLUB-01) |
| NON_MEMBER → PENDING_REQUEST      | `POST /api/ext/clubreq/:id/request` (SOCIAL) | authentifié                                            |
| PENDING_REQUEST → MEMBER/DECLINED | `.../approve` `.../decline`                  | ADMIN/MOD du club                                      |
| INVITED → MEMBER                  | `POST /api/clubs/:id/accept`                 | l'invité (⚠ garde trop large, CLUB-02)                 |
| NON_MEMBER → INVITED              | `POST /api/clubs/:id/invite`                 | **tout MEMBER** ⚠ (CLUB-03)                            |
| role change / leave / delete      | endpoints dédiés                             | OWNER/ADMIN selon                                      |

### 2.6 — Events / RSVP

**États :** un « Event » = Room avec `scheduledFor`. `SCHEDULED → LIVE → ENDED` (+ chemin `CANCELED`, **non distinct en base** : réutilise endedAt). RSVP par (room,user) : NO_RSVP ↔ RSVPED.

| De → Vers                  | Trigger                                            | RBAC                                         |
| -------------------------- | -------------------------------------------------- | -------------------------------------------- |
| SCHEDULED → LIVE           | Job `go-live` T-0 (⚠ ne supprime pas scheduledFor) | Système                                      |
| SCHEDULED → ENDED (cancel) | `POST /api/ext/events/:id/cancel`                  | HOST (⚠ accepte une room déjà LIVE, EVEN-01) |
| SCHEDULED → RSVPED         | `POST /api/rooms/:id/rsvp`                         | authentifié                                  |
| reminder T-15 / T-5        | jobs BullMQ `remind15` / `remind`                  | Système                                      |

**Effets (17)** : notifs ROOM_STARTED (T-5), RSVP_REMINDER (T-15, ⚠ audiences divergentes EVEN-06), notif d'annulation via bucket ROOM_STARTED.

### 2.7 — Recording / Replay (LiveKit Egress)

**États :** `STARTING → ACTIVE → COMPLETED | FAILED | ABORTED`. Feature-flag complet (no-op si egress non configuré). Couplé au cycle Room.

| De → Vers         | Trigger                                                                                              | RBAC                           |
| ----------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------ |
| ∅ → STARTING      | `startForRoom` (création room live recordingEnabled, ou go-live)                                     | indirect (créateur de room)    |
| ACTIVE → terminal | webhook `POST /webhooks/livekit` (signé) ; `stopForRoom` (fin room) ; `reconcileRoom` (à la lecture) | LiveKit signé / host / lecteur |

**Effets (10)** : création ligne Recording, `startRoomCompositeEgress`, `stopEgress`, `applyEgressInfo` (⚠ écriture sans garde terminale RECO-04). Lecture : `listForRoom` (⚠ pas de filtre privé RECO-02) vs `listRecent` (filtre isPrivate=false).

### 2.8 — Paiements / Monétisation (Stripe)

Trois sous-machines : **Connect** (NONE→ONBOARDING→KYC_INCOMPLETE→KYC_COMPLETE, source = mapping Redis) ; **Tip** (`PENDING→SUCCEEDED/FAILED/REFUNDED` — en pratique naît SUCCEEDED via webhook ; FAILED/REFUNDED = code mort) ; **Premium** (Subscription miroir Stripe + flags User, écrits **uniquement** par webhook).

| De → Vers                   | Trigger                                                 | RBAC         |
| --------------------------- | ------------------------------------------------------- | ------------ |
| Tip ∅ → SUCCEEDED           | webhook `payment_intent.succeeded` → recordTip          | Stripe signé |
| Tip → FAILED / REFUNDED     | **aucun** (non implémenté)                              | —            |
| Premium CHECKOUT → ACTIVE   | webhook `checkout.session.completed` / `subscription.*` | Stripe signé |
| onboard / checkout / portal | `POST /api/ext/payments\|premium/*`                     | self         |

### 2.9 — Modération

**États :** Report OPEN/RESOLVED/DISMISSED · RoomBan NONE/TEMP/PERMANENT/EXPIRED · User ACTIVE/SUSPENDED_TEMP/SUSPENDED_PERM/SOFT_DELETED/HARD_PURGED · appRole USER/MOD/ADMIN/SUPER_ADMIN · Impersonation · RoomChatMessage VISIBLE/DELETED · Room LIVE/FORCE_ENDED.

| De → Vers                                 | Trigger                                                          | RBAC                                                |
| ----------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| → Report OPEN                             | `POST /api/users\|rooms/:id/report`                              | authentifié                                         |
| OPEN → RESOLVED/DISMISSED                 | `POST /api/admin/reports/:id/resolve`                            | MOD+ + GODMODE                                      |
| ACTIVE → SUSPENDED / → ACTIVE             | `.../suspend` `.../unsuspend`                                    | MOD+                                                |
| ACTIVE → SOFT_DELETED                     | admin `DELETE` (SUPER_ADMIN) ou self `POST /me/request-deletion` | SUPER_ADMIN / self                                  |
| SOFT_DELETED → HARD_PURGED                | cron GDPR quotidien                                              | Système (⚠ cascade efface AuditLog acteur, MODE-01) |
| → FORCE_ENDED / role change / impersonate | endpoints admin                                                  | ADMIN/SUPER_ADMIN                                   |

**Effets (18)** : AuditLog (REPORT*\*, USER_SUSPENDED/DELETED/ROLE_CHANGED, ROOM_FORCE_ENDED, IMPERSONATION*\*, GODMODE_ACCESS), cache Redis suspension (TTL 60s), cascade purge. ⚠ kick/ban room et suppression de message ne sont pas audités (MODE-06).

### 2.10 — OTP / Auth

**États :** OtpCode unused/attempts/exhausted/consumed/expired/purged · PasswordResetToken · RefreshToken active/rotated/expired/purged · AccessToken valid/blacklisted/expired (⚠ sans `jti`) · User anonymous/authenticated/new/suspended.

| De → Vers                                       | Trigger                         | RBAC                                                                          |
| ----------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------- |
| OTP unused → consumed (+session)                | `POST /api/auth/verify-otp`     | public (⚠ non transactionnel OTP-01)                                          |
| RefreshToken active → rotated (+nouvelle paire) | `POST /api/auth/refresh`        | possession du token (⚠ pas de check suspension AUTH-01, pas atomique AUTH-02) |
| AccessToken → blacklisted + refresh révoqués    | `POST /api/auth/logout`         | self (⚠ ne révoque que l'access du caller AUTH-03)                            |
| reset-password                                  | `POST /api/auth/reset-password` | possession du token email                                                     |

---

## 3. Anomalies confirmées — détail (Bloquante + Majeures)

> Format : **[ID]** Titre — _catégorie_ · `réf` · **Repro** · **Attendu / Obtenu** · **🔧 Recommandation**.

### 🔴 BLOQUANTE

#### [PAYM-03] Tip vers un utilisateur supprimé → débit réel puis webhook bloqué en boucle de retry

_cycle-de-vie_ · [payments.service.ts:143](../../backend/src/extensions/modules/payments/payments.service.ts#L143), [gdpr-purge.worker.ts:73](../../backend/src/workers/gdpr-purge.worker.ts#L73)
`tip()` ne valide le destinataire que via le mapping Redis `ext:stripe:account:<toUserId>`, **jamais purgé** à la suppression de compte. Après hard-delete du créateur : un tip est encaissé et transféré, puis `recordTip → prisma.tip.upsert` viole la FK `toUserId` (onDelete:Cascade) → throw → le webhook renvoie 500 et libère le claim de dédup → **Stripe rejoue indéfiniment, l'argent ayant déjà bougé.**
**Repro :** créateur onboardé+KYC → suppression+purge GDPR (mapping Redis survit) → A tipe B (gardes passées) → paiement capturé → webhook succeeded → FK violation → 500 → retries en boucle.
**Attendu :** validation DB du destinataire (existant, `deletedAt` null) avant Checkout ; purge du mapping Redis + annulation payouts à la suppression. **Obtenu :** aucune validation DB, mapping orphelin, boucle de panne après débit.
**🔧** (1) Dans `tip()`, charger `prisma.user.findUnique` sur `toUserId` et rejeter si absent/`deletedAt` set, **avant** le Checkout. (2) Dans le worker GDPR, supprimer `ext:stripe:account:<id>` et `*:lock`. (3) Entourer `recordTip` d'un `try/catch` qui **ACK le webhook (200)** sur FK violation (event non rejouable) en loggant/alertant pour réconciliation manuelle, afin de stopper la boucle.

### 🟠 MAJEURES

#### [ROOM-01] Un MODÉRATEUR peut rétrograder le HOST (role=SPEAKER/LISTENER)

_rbac_ · [rooms.service.ts:528](../../backend/src/modules/rooms/rooms.service.ts#L528)
`setRole` (sous `requireHostOrMod`, donc accessible aux mods) ne protège la cible host que pour `role=HOST` (:532) et `role=MODERATOR` (:539). Pour `SPEAKER`/`LISTENER`, **aucune garde** : un mod écrase `Participant.role` du host, mais `Room.hostId` reste inchangé → état incohérent + `room:role_changed` trompeur. Asymétrie nette vs `setMute` (ROOM_009) et `kick` (ROOM_003) qui protègent le host.
**Repro :** host promeut M en MODERATOR → M fait `PATCH /role {userId:host, role:LISTENER}` → succès.
**Attendu :** rejet (ROOM_003), comme kick/mute. **Obtenu :** rétrogradation acceptée, hostId désynchronisé.
**🔧** Ajouter en tête de `setRole` : `if (input.userId === room.hostId && input.role !== 'HOST') throw new AppError('ROOM_003')`.

#### [PART-01] Un MODÉRATEUR rétrograde le HOST en LISTENER → coupe l'audio du host

_transition-invalide-non-bloquée_ · [rooms.service.ts:528](../../backend/src/modules/rooms/rooms.service.ts#L528)
Conséquence aggravée de ROOM-01 : `canPublishInRoom` voit `role=LISTENER` et **refuse la publication audio du host** (`rtc:produce` → NOT_A_SPEAKER ; livekit-token `canPublish=false`). Un mod peut museler durablement le host (au-delà du mute, lui bloqué par ROOM_009).
**🔧** Même correctif que ROOM-01 (garde cible≠host pour tout role≠HOST).

#### [PART-02] L'extension `/promote` laisse un MODÉRATEUR créer d'autres MODÉRATEURS

_rbac_ · [speakInvite.service.ts:117](../../backend/src/extensions/modules/speakInvite/speakInvite.service.ts#L117)
Le legacy réserve la promotion MODERATOR au HOST (ROOM_003 sinon). `promoteToModerator` gate via `isHostOrMod` (accepte les mods) → escalade de privilèges (un mod fabrique des mods).
**Repro :** host promeut M1 mod → M1 `POST /api/ext/speak-invite/:room/promote/:U2` → U2 devient MODERATOR.
**🔧** Restreindre `promoteToModerator` au host strict (charger `room.hostId === callerId`, sinon ROOM_003), cohérent avec le legacy.

#### [PART-03] `isHostOrMod` (extension) ignore `leftAt` et `endedAt`

_rbac_ · [speakInvite.service.ts:31](../../backend/src/extensions/modules/speakInvite/speakInvite.service.ts#L31)
Le helper ne lit ni `leftAt` (participant) ni `room.endedAt`. Un mod ayant **quitté** la room (ou une room **terminée**) laisse passer invite/promote. Le legacy `requireHostOrMod` vérifie les deux.
**🔧** Aligner sur le legacy : `select { leftAt }`, filtrer `leftAt: null`, et rejeter si `room.endedAt` non null.

#### [PART-04] `speakInvite.respond` promeut SPEAKER sans vérifier room ni capacité

_effet-de-bord_ · [speakInvite.service.ts:71](../../backend/src/extensions/modules/speakInvite/speakInvite.service.ts#L71)
`respond(accept)` ne charge jamais la Room : ni `endedAt`/`isLive`, ni `leftAt` de l'invité, ni `maxSpeakers`. On peut créer un SPEAKER dans une room terminée, sur un participant parti, au-delà du cap.
**🔧** Faire passer `respond(accept)` par `roomsService.setRole(roomId, {userId, role:'SPEAKER'})` (qui contient déjà toutes les gardes), au lieu d'un `update` direct.

#### [HAND-01] Re-promotion d'un SPEAKER déjà en place rejoue tous les effets de bord

_idempotence_ · [rooms.service.ts:594](../../backend/src/modules/rooms/rooms.service.ts#L594)
`updateMany {leftAt:null}` matche même si la cible est déjà SPEAKER (count=1) → re-création notif HAND_ACCEPTED + push + `room:hand_lowered` à chaque appel. Double-clic « monter sur scène » = spam.
**🔧** Court-circuiter si le rôle est inchangé : lire le rôle courant et `return` (no-op) si déjà SPEAKER, avant les effets de bord.

#### [HAND-02] `speakInvite.respond(accept)` ne vérifie pas `maxSpeakers`

_validation-champ_ · [speakInvite.service.ts:94](../../backend/src/extensions/modules/speakInvite/speakInvite.service.ts#L94)
Le legacy applique `maxSpeakers` en tx Serializable (ROOM_002). L'extension écrit `role='SPEAKER'` sans aucun count → cap contournable via le flux invite.
**🔧** Idem PART-04 : déléguer à `setRole(SPEAKER)`.

#### [HAND-03] `speakInvite.respond(accept)` ne vérifie pas `leftAt`

_cycle-de-vie_ · [speakInvite.service.ts:94](../../backend/src/extensions/modules/speakInvite/speakInvite.service.ts#L94)
`findUnique` sans filtre `leftAt` → un utilisateur sorti/kické est promu SPEAKER en base (visible au prochain re-join).
**🔧** Idem PART-04.

#### [HAND-04] `speakInvite.respond(accept)` diverge totalement de `setRole`

_effet-de-bord_ · [speakInvite.service.ts:93](../../backend/src/extensions/modules/speakInvite/speakInvite.service.ts#L93)
Pas de purge `RoomHandRaise`, pas de `room:role_changed`, pas de HAND_ACCEPTED → main fantôme dans la file FIFO + clients désynchronisés (seul `speak_invite_response` part).
**🔧** Idem PART-04 (la délégation à `setRole` apporte tous ces effets gratuitement).

#### [HAND-05] `leave()` ne purge pas `RoomHandRaise` → main fantôme

_cycle-de-vie_ · [rooms.service.ts:424](../../backend/src/modules/rooms/rooms.service.ts#L424)
`leave()` pose `leftAt` mais ne supprime pas la ligne hand-raise (seuls lowerHand/kick/setRole le font). `listHandRaises` ne filtre pas `leftAt` → la tête de file peut être un partant ; le host tente de la promouvoir → USER_001, file polluée.
**🔧** Ajouter `roomHandRaise.deleteMany({ where:{ roomId, userId } })` dans `leave()` (et idéalement filtrer `leftAt` dans `listHandRaises` via jointure participant actif).

#### [FOLL-01] Le workflow « demande de suivi » (pending→accept/reject) n'existe pas

_transition-invalide-non-bloquée_ · [follow.service.ts:27](../../backend/src/modules/follow/follow.service.ts#L27)
`follow()` ne lit jamais `target.isPrivateAccount` : suivre un compte **privé** crée l'edge immédiatement et notifie NEW_FOLLOWER. Aucun état PENDING (pas de colonne status, pas de modèle FollowRequest, pas de type de notif). Le suivi débloque présence réciproque + fanout ROOM_STARTED.
**Repro :** B passe privé → A `POST /api/follow/B` → following:true instantané, sans approbation.
**🔧 (décision produit requise — voir §6)** Si les comptes privés doivent gater le suivi : ajouter un modèle `FollowRequest` (ou `Follow.status PENDING/ACCEPTED`), un type de notif `FOLLOW_REQUEST`, des endpoints accept/reject, et faire de `follow()` un créateur de demande quand `target.isPrivateAccount`. Sinon, retirer `isPrivateAccount` du discours produit.

#### [FOLL-02] `follow()` ignore le graphe de blocage

_transition-invalide-non-bloquée_ · [follow.service.ts:27](../../backend/src/modules/follow/follow.service.ts#L27)
Aucun appel à `getBlockedIdSet`. Un utilisateur bloqué (dans un sens ou l'autre) peut recréer l'edge Follow que `block()` venait de supprimer + déclencher une notif NEW_FOLLOWER vers celui qui l'a bloqué → vecteur de harcèlement.
**Repro :** B bloque A → A `POST /api/follow/B` → edge recréé + notif à B.
**🔧** Charger le set de blocage et rejeter (USER_004 ou équivalent) si l'une des parties a bloqué l'autre, avant toute écriture — comme le fait déjà `wave()`.

#### [FOLL-03] `block()` supprime des edges sans décrémenter les compteurs

_effet-de-bord_ · [social.service.ts:92](../../backend/src/modules/social/social.service.ts#L92)
La transaction de block fait `follow.deleteMany` bidirectionnel mais ne touche pas `followerCount`/`followingCount` → compteurs durablement gonflés (jusqu'à 4 compteurs faux par block mutuel).
**🔧** Dans la même transaction, décrémenter (plancher 0 via `GREATEST`) les compteurs des deux parties pour chaque edge réellement supprimé.

#### [CLUB-01] La garde d'approbation SOCIAL est contournable via `POST /api/clubs/:id/join`

_transition-invalide-non-bloquée_ · [clubs.service.ts:88](../../backend/src/modules/clubs/clubs.service.ts#L88)
La garde SOCIAL (PENDING_REQUEST + approbation) vit **uniquement** dans l'extension `clubreq`. Le core `join()` ne bloque que PRIVATE (CLUB_003) ; un club SOCIAL tombe en _fall-through_ → adhésion MEMBER immédiate sans approbation.
**Repro :** créer club SOCIAL → `POST /api/clubs/:id/join` (au lieu de `/api/ext/clubreq/:id/request`) → 200 joined, aucune demande.
**🔧** Dans `join()`, traiter SOCIAL comme nécessitant une demande : rejeter (ex. CLUB_003-équivalent « passez par la demande ») ou rediriger vers le flux clubreq.

#### [CLUB-02] `acceptInvitation` matche n'importe quelle notif CLUB_INVITE → intrusion club PRIVÉ

_rbac_ · [clubs.service.ts:182](../../backend/src/modules/clubs/clubs.service.ts#L182)
La garde accepte toute notif `type=CLUB_INVITE` avec `data.clubId===clubId`, en ignorant `data.kind`. Or ce type est réutilisé pour 4 événements (invite réel, join_request, join_approved, **join_declined**). Un utilisateur **refusé** conserve une notif join_declined → si l'admin bascule le club en PRIVÉ, ce refusé peut `POST /accept` et rejoindre le club privé.
**🔧** Resserrer la garde : n'accepter que la _vraie_ invitation (`data.inviterId` présent / `data.kind` absent), pas les notifs de cycle de demande.

#### [CLUB-03] Tout MEMBRE peut inviter dans un club PRIVÉ

_rbac_ · [clubs.service.ts:136](../../backend/src/modules/clubs/clubs.service.ts#L136)
`invite()` ne vérifie que l'**existence** de l'appartenance (CLUB_002), pas le rôle ni la privacy. Pour un club PRIVÉ (seul chemin d'entrée = invite→accept), un simple MEMBER peut faire entrer n'importe qui, contournant le gatekeeping owner/admin.
**Repro :** owner invite B (MEMBER) → B `POST /api/clubs/:id/invite {userIds:[C]}` → C peut accepter et rejoindre le club privé.
**🔧** Restreindre `invite()` aux rôles OWNER/ADMIN (et éventuellement MODERATOR) ; charger le rôle de l'inviteur.

#### [EVEN-01] `cancel` d'event agit sur une room DÉJÀ LIVE et abandonne les participants

_transition-invalide-non-bloquée_ · [events.service.ts:25](../../backend/src/extensions/modules/events/events.service.ts#L25)
`cancel` ne teste que `scheduledFor != null` mais pas `isLive`. Or `go-live` ne supprime jamais `scheduledFor` → on peut annuler une room **en direct**. `cancel` pose seulement `endedAt`/`isLive=false` sans teardown (pas de `leftAt`, `currentRoomId=null`, `participantCount=0`, `closeSfuRoom`, `room:ended`). Résultat : room « morte » mais participants/SFU actifs + notif « Event canceled » envoyée à des gens dans la room.
**🔧** Soit rejeter si `room.isLive` (réserver cancel aux SCHEDULED), soit déléguer à `roomsService.end()` pour un teardown complet.

#### [RECO-01] `forceEndRoom` (admin) ne finalise jamais l'enregistrement

_effet-de-bord_ · [admin.service.ts:436](../../backend/src/modules/admin/admin.service.ts#L436)
Documenté comme miroir de `roomsService.end`, mais n'appelle pas `recordingsService.stopForRoom`. Sur un force-end de room en cours d'enregistrement, l'egress LiveKit continue (facturation + upload) jusqu'à un webhook spontané ; pour une room privée, `listForRoom` n'étant jamais appelé, l'egress peut rester orphelin indéfiniment.
**🔧** Ajouter `void recordingsService.stopForRoom(roomId).catch(...)` dans `forceEndRoom`.

#### [RECO-02] `listForRoom` expose les replays des rooms PRIVÉES (IDOR)

_rbac_ · [recordings.service.ts:238](../../backend/src/modules/recordings/recordings.service.ts#L238)
`GET /api/recordings/room/:roomId` (requireAuth seul) ne filtre que roomId+COMPLETED+fileUrl. Contrairement à `listRecent` (qui ajoute `room.isPrivate=false`), aucun filtre de confidentialité ni membership → tout utilisateur connecté récupère les `fileUrl` (CDN public) des rooms privées en énumérant les roomId.
**🔧** Ajouter le filtre `room: { isPrivate: false }` (ou un contrôle host/membership pour les rooms privées), comme `listRecent`.

#### [PAYM-04] Webhook `subscription.*` pour un utilisateur supprimé → boucle de retry

_cycle-de-vie_ · [premium.service.ts:147](../../backend/src/extensions/modules/premium/premium.service.ts#L147)
`syncSubscription` exécute `prisma.user.update` inconditionnellement. Si l'utilisateur a été purgé alors que sa sub Stripe est active (cf. PAYM-05), Stripe émet `subscription.updated/deleted` → P2025/FK → 500 → retries Stripe sans fin.
**🔧** Court-circuiter proprement (`return`) si l'utilisateur n'existe plus ; envelopper les writes pour ACK le webhook plutôt que throw.

#### [PAYM-05] Suppression de compte : aucune annulation de l'abonnement Stripe → facturation continue

_effet-de-bord_ · [gdpr-purge.worker.ts:44](../../backend/src/workers/gdpr-purge.worker.ts#L44)
Le worker hard-delete l'utilisateur (+ cascade Subscription) mais n'appelle jamais `stripe.subscriptions.cancel`. Un premium qui supprime son compte **continue d'être facturé** (risque financier + RGPD : données chez Stripe persistent).
**🔧** Avant/pendant la purge : `stripe.subscriptions.cancel` + nettoyage du mapping Connect (et idéalement `customers.del`).

#### [MODE-01] La purge GDPR détruit la piste d'audit des actions de l'admin purgé

_effet-de-bord_ · [schema.prisma:754](../../backend/prisma/schema.prisma#L754)
`AuditLog.actor` est `onDelete: Cascade`. Un compte privilégié qui demande sa suppression RGPD voit, 30 j plus tard, **toutes ses lignes d'audit** (USER*SUSPENDED, ROOM_FORCE_ENDED, IMPERSONATION*\*…) effacées — contredisant l'invariant « append-only » et le champ `targetUser` qui, lui, est en `SetNull`.
**🔧** Passer `AuditLog.actor` en `onDelete: SetNull` (ou conserver `actorId` anonymisé) via migration, pour rendre le trail non destructible par l'acteur.

#### [AUTH-01] `refresh` ne contrôle ni suspension ni suppression de compte

_cycle-de-vie_ · [auth.service.ts:93](../../backend/src/modules/auth/auth.service.ts#L93)
`refresh()` ne lit ni `suspendedUntil`, ni `deletedAt`, ni l'existence du user. Un suspendu/soft-deleted peut appeler `/auth/refresh` en boucle et prolonger indéfiniment sa session (la rotation déplace l'horizon de 7 j à chaque appel), alors que `requireAuth` le bloquerait.
**🔧** Charger l'utilisateur dans `refresh()` et rejeter (AUTH_007 si suspendu, AUTH_003/404 si absent/`deletedAt`) avant `issueTokenPair` ; révoquer la famille de tokens du compte sanctionné lors de la suspension/suppression.

#### [AUTH-02] Rotation de refresh-token non atomique → deux familles de tokens valides

_concurrence_ · [auth.service.ts:93](../../backend/src/modules/auth/auth.service.ts#L93)
`findUnique` puis `update` inconditionnel hors transaction. Deux `/auth/refresh` concurrents avec le même jti passent tous deux la garde → deux paires valides. De plus, la réutilisation d'un jti déjà tourné ne déclenche aucune révocation de famille (pas de détection de vol).
**🔧** Révocation conditionnelle atomique : `updateMany { where:{ token, revokedAt:null } }`, vérifier `count===1` (sinon AUTH_004), le tout en `$transaction` avec l'émission ; en cas de replay d'un jti déjà révoqué, révoquer toute la famille du user.

#### [OTP-01] `verify-otp` non transactionnel → double compte / double session pour un OTP unique

_concurrence_ · [otp.service.ts:59](../../backend/src/modules/otp/otp.service.ts#L59)
`findFirst(isUsed:false)` puis `update(isUsed:true)` séparés, sans tx ni update conditionnel. Deux `/verify-otp` concurrents franchissent tous deux la garde → garantie one-shot brisée ; le find-or-create n'étant pas un upsert, on obtient soit deux sessions, soit une collision `@unique phoneNumber` (500).
**🔧** Consommation atomique conditionnelle (`updateMany { where:{ id, isUsed:false } }`, exiger `count===1`) + `user.upsert`, en transaction.

#### [AUTH-03] `reset-password` et `logout` ne révoquent pas les access tokens en cours

_cycle-de-vie_ · [auth.service.ts:108](../../backend/src/modules/auth/auth.service.ts#L108)
Les refresh tokens sont révoqués, mais les access tokens (sans `jti`, blacklist par sha256 du token brut) ne le sont pas, hormis le seul token du caller au logout. Après un reset (typiquement compte compromis), un access token volé reste valide jusqu'à 15 min sur tous les autres appareils.
**🔧** Ajouter un `jti` par access token + blacklist par jti, **ou** un marqueur `tokensValidAfter`/`tokenVersion` par user vérifié dans `requireAuth`, mis à jour au reset/logout cross-device.

---

## 4. Anomalies confirmées — Mineures (51)

> Compactées par workflow. `réf` = fichier:ligne ; 🔧 = piste de correction.

### Room lifecycle

| ID      | Anomalie                                                        | Réf                  | 🔧                                                             |
| ------- | --------------------------------------------------------------- | -------------------- | -------------------------------------------------------------- |
| ROOM-03 | force-end n'annule pas les jobs BullMQ (jobs orphelins)         | admin.service.ts:436 | Appeler `cancelEventReminder(roomId)` dans `forceEndRoom`      |
| ROOM-04 | Course join/auto-close : room ENDED avec participantCount>0     | rooms.service.ts:464 | Update conditionnel `WHERE endedAt IS NULL` + re-garde au join |
| ROOM-05 | Course host-leave : double auto-promotion / hostId écrasé       | rooms.service.ts:437 | `updateMany WHERE hostId=oldHost` (CAS) ou Serializable        |
| ROOM-06 | Socket `room:end` émet `room:ended` 2× (service + handler)      | rooms.service.ts:520 | Émettre une seule fois (retirer l'émission du handler)         |
| ROOM-07 | force-end d'une SCHEDULED ne notifie aucun RSVP                 | admin.service.ts:441 | Notifier les RSVP + purger les reminders                       |
| ROOM-08 | Auto-close vide n'émet pas `room:ended` (participants fantômes) | rooms.service.ts:468 | Émettre `room:ended` aussi à l'auto-close                      |

### Participant roles

| ID      | Anomalie                                                                | Réf                       | 🔧                                                      |
| ------- | ----------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------- |
| PART-05 | speakInvite.respond n'émet pas role_changed/HAND_ACCEPTED ni clear hand | speakInvite.service.ts:99 | Déléguer à `setRole` (cf. PART-04)                      |
| PART-06 | Co-hosts à la création + speakInvite contournent maxSpeakers            | rooms.service.ts:198      | Appliquer le cap sur tous les chemins créant un SPEAKER |
| PART-07 | self-mute possible dans une room terminée                               | rooms.service.ts:612      | Vérifier `endedAt`/`isLive` dans `setMute`              |
| PART-08 | Aucun endpoint d'unban (ban permanent irréversible)                     | rooms.service.ts:1027     | Ajouter un endpoint host `DELETE roomBan`               |
| PART-09 | speakInvite.invite émet notif/socket même si l'invité absent de la room | speakInvite.service.ts:46 | Vérifier la présence active avant d'inviter             |
| PART-10 | Auto-succession HOST : successeur muté/parti, fenêtre de course         | rooms.service.ts:442      | `updateMany WHERE leftAt:null` + reset `isMuted=false`  |

### Hand-raise

| ID      | Anomalie                                                                  | Réf                       | 🔧                                                       |
| ------- | ------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------- |
| HAND-06 | `lowerHand()` émet `room:hand_lowered` même si rien supprimé / non-membre | rooms.service.ts:858      | `requireActiveParticipant` + n'émettre que si count>0    |
| HAND-07 | socket `room:request-speak` ne persiste rien (divergence REST)            | room.handler.ts:86        | Déléguer le socket à `raiseHand`                         |
| HAND-08 | Re-promotion SPEAKER lève ROOM_002 à tort en room pleine                  | rooms.service.ts:549      | Court-circuiter si rôle inchangé avant le check capacité |
| HAND-09 | respond(accept) broadcast `accepted:true` même si no-op (déjà SPEAKER)    | speakInvite.service.ts:98 | Statut neutre si déjà sur scène                          |

### Follow

| ID      | Anomalie                                             | Réf                  | 🔧                                                              |
| ------- | ---------------------------------------------------- | -------------------- | --------------------------------------------------------------- |
| FOLL-04 | Race follow/unfollow : compteur gonflé sans relation | follow.service.ts:33 | Mutation edge + compteurs dans une seule tx, ou recompute COUNT |
| FOLL-05 | Notif NEW_FOLLOWER jamais retirée à l'unfollow       | follow.service.ts:70 | Retirer la notif à l'unfollow ou cooldown anti-spam             |
| FOLL-06 | Fanout ROOM_STARTED diffuse aux followers bloqués    | followFanout.ts:55   | Exclure le set de blocage de l'host avant dispatch              |

### Club membership

| ID      | Anomalie                                                                | Réf                         | 🔧                                                               |
| ------- | ----------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------- |
| CLUB-04 | Race join/accept → P2002 non géré → 500 au lieu de CLUB_004             | clubs.service.ts:98         | Catch P2002 → idempotent {joined:true} ou 409                    |
| CLUB-05 | clubMeta : refus RBAC renvoie 400 PAY_INVALID au lieu de 403            | clubMeta.service.ts:34      | Renvoyer 403 (AUTH_008/CLUB_002)                                 |
| CLUB-06 | Demande SOCIAL re-soumise après expiration ne re-notifie pas les admins | clubreq.service.ts:96       | TTL aligné sur la clé de demande / traiter comme 1ère soumission |
| CLUB-07 | Clés Redis clubreq/clubmeta orphelines après suppression du club        | clubs.service.ts:268        | Purger les clés d'extension dans `remove()`                      |
| CLUB-08 | Push d'approbation/refus silencé par la préférence clubInvite           | notifications.service.ts:21 | Bucket distinct pour les issues de sa propre demande             |

### Events / RSVP

| ID      | Anomalie                                                             | Réf                   | 🔧                                                              |
| ------- | -------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------- |
| EVEN-02 | RSVP accepté sur une room programmée déjà LIVE                       | rooms.service.ts:633  | Garder sur `isLive`, pas `scheduledFor`                         |
| EVEN-03 | Race go-live vs cancel (l'un écrase l'autre)                         | eventReminders.ts:118 | Update conditionnel `WHERE endedAt IS NULL`                     |
| EVEN-04 | Rappel T-15 jamais armé à la création (dépend d'un scan cron étroit) | reminder15.ts:13      | `scheduleReminder15` à la création                              |
| EVEN-05 | Toggle `RoomRsvp.reminder` jamais lu (désinscription impossible)     | schema.prisma:407     | Respecter `WHERE reminder=true` + endpoint, ou retirer le champ |
| EVEN-06 | Audiences divergentes entre rappels T-5 et T-15                      | eventReminders.ts:193 | Aligner destinataires/types des deux rappels                    |
| EVEN-07 | `cancelRsvp` succès silencieux sur room inexistante/terminée         | rooms.service.ts:645  | Retourner le count réel / 404                                   |
| EVEN-08 | « CANCELED » indiscernable d'une fin normale (pas de marqueur)       | events.service.ts:31  | Marqueur `canceledAt`/statut + type de notif dédié              |

### Recording

| ID      | Anomalie                                                                    | Réf                       | 🔧                                                      |
| ------- | --------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------- |
| RECO-04 | `applyEgressInfo` peut faire reculer un Recording terminal (webhook rejoué) | recordings.service.ts:107 | Garde : n'écrire que si statut non terminal             |
| RECO-05 | `fileUrl` publié en `s3://` injouable si `RECORDING_PUBLIC_BASE_URL` absent | recordings.service.ts:97  | Inclure la var dans `isConfigured()` ou ne pas surfacer |

### Payments

| ID      | Anomalie                                                           | Réf                     | 🔧                                                |
| ------- | ------------------------------------------------------------------ | ----------------------- | ------------------------------------------------- |
| PAYM-01 | `payment_intent.payment_failed` non géré (échec invisible)         | payments.webhook.ts:24  | Handler → Tip FAILED / trace                      |
| PAYM-02 | Aucun chemin de remboursement (SUCCEEDED→REFUNDED jamais écrit)    | payments.webhook.ts:24  | Handler `charge.refunded` → REFUNDED              |
| PAYM-06 | `customers.create` sans idempotencyKey → customer Stripe orphelin  | premium.service.ts:40   | idempotencyKey `cust:<userId>` + verrou           |
| PAYM-07 | Fenêtre d'idempotence tips fusionne deux tips identiques légitimes | payments.service.ts:150 | Clé incluant un nonce client (cibler les retries) |
| PAYM-08 | `getStatus` vs `isPremium` incohérents sur période expirée         | premium.service.ts:64   | Appliquer `premiumUntil<now` dans `getStatus`     |

### Moderation

| ID      | Anomalie                                                               | Réf                   | 🔧                                                           |
| ------- | ---------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------ |
| MODE-02 | Cooldown report posé AVANT le create DB (verrouille 24h sur échec)     | social.service.ts:133 | Poser la clé après succès, ou `del` dans un catch            |
| MODE-03 | chatmod : co-host (HOST) ne peut pas supprimer ; mod parti le peut     | chatmod.service.ts:31 | Accepter HOST + exiger `leftAt=null` (cf. requireHostOrMod)  |
| MODE-04 | force-end : check idempotence non atomique (effets dupliqués)          | admin.service.ts:437  | Update conditionnel `WHERE endedAt IS NULL`                  |
| MODE-05 | resolveReport : double ligne AuditLog sous double-résolution           | admin.service.ts:391  | `updateMany WHERE resolvedAt:null`, n'auditer que si count=1 |
| MODE-06 | Aucun audit pour kick/RoomBan ni suppression de message                | rooms.service.ts:1012 | Étendre AuditAction + `auditLogService.record`               |
| MODE-07 | Compte en demande de suppression RGPD garde ses pouvoirs de modération | users.service.ts:309  | Vérifier `deletedAt` dans requireAuth/requireRole            |
| MODE-08 | `cancelDeletion` réactive aussi un compte soft-supprimé par l'admin    | users.service.ts:320  | Garder sur l'origine de la suppression                       |
| MODE-09 | Lockout résiduel ~60s après expiration naturelle d'une suspension      | auth.middleware.ts:79 | TTL cache ≤ temps restant de suspension                      |

### OTP / Auth

| ID      | Anomalie                                                                 | Réf                 | 🔧                                                          |
| ------- | ------------------------------------------------------------------------ | ------------------- | ----------------------------------------------------------- |
| OTP-02  | Plafond de tentatives OTP non atomique (amplification brute-force)       | otp.service.ts:60   | Incrément+test atomiques (update conditionnel / FOR UPDATE) |
| OTP-03  | send-otp invalide les anciens codes AVANT l'envoi SMS (blocage si échec) | otp.service.ts:28   | Committer le code après confirmation d'envoi / rollback     |
| AUTH-04 | Refresh tokens accumulés sans plafond ni nettoyage                       | issueTokenPair.ts:7 | Plafonner les sessions actives par user                     |
| AUTH-05 | username non normalisé en casse (doublons, login impossible)             | auth.service.ts:46  | Normaliser lowercase (comme l'email) ou colonne `citext`    |
| AUTH-06 | forgot-password : oracle d'énumération par timing                        | auth.service.ts:126 | Égaliser le coût des deux chemins (travail factice / délai) |

---

## 5. Tests automatisés livrés

Ajoutés dans [backend/tests/workflows/](../../backend/tests/workflows/) (dossier dédié — aucun test existant modifié). Ils suivent la convention `supertest` du dépôt et encodent les scénarios d'audit **déterministes** (transitions valides, transitions invalides bloquées, RBAC, doublons).

| Fichier                            | Couvre                                                                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `rooms-roles.workflow.test.ts`     | Transition valide LISTENER→SPEAKER ; non-host bloqué (ROOM_003) ; **ROOM-01/PART-01** (mod rétrograde le host) en `it.failing`                  |
| `follow.workflow.test.ts`          | follow/unfollow ; self-follow USER_003 ; **FOLL-01** (compte privé instantané) + **FOLL-02** (blocage ignoré) en `it.failing`                   |
| `club-membership.workflow.test.ts` | join OPEN ; PRIVATE→CLUB_003 ; accept sans invite→CLUB_007 ; **CLUB-01** (bypass SOCIAL) + **CLUB-03** (membre invite en privé) en `it.failing` |
| `auth-session.workflow.test.ts`    | rotation refresh ; **AUTH-01** (refresh d'un suspendu) + **AUTH-05** (doublon de casse) en `it.failing`                                         |

> **`it.failing`** : le test **passe tant que le bug existe** (il documente l'écart) et **deviendra rouge quand le bug sera corrigé** — signal automatique pour basculer le test en `it()` normal une fois le correctif livré. Aucun test ne « casse le build ».

**Prérequis d'exécution** (infra existante) : Postgres (host `:5433`) + Redis lancés (`docker compose -f backend/docker-compose.yml up -d`) puis `prisma db push`. Lancer **feature par feature en `--runInBand`** (contrainte RAM connue) :

```bash
cd backend
npx jest tests/workflows/follow.workflow --runInBand
npx jest tests/workflows/rooms-roles.workflow --runInBand
npx jest tests/workflows/club-membership.workflow --runInBand
npx jest tests/workflows/auth-session.workflow --runInBand
```

Les bugs nécessitant LiveKit/Stripe/egress/concurrence (RECO-02, PAYM-_, _-concurrence) sont **documentés mais non automatisés** (infra externe / non déterministe) — voir §6.

---

## 6. Décisions produit en attente & priorisation

### Questions ouvertes (règles métier ambiguës — à trancher avant correctif)

1. **FOLL-01 — Comptes privés :** veut-on réellement une machine _demande de suivi (pending→accept/reject)_ ? Si oui, c'est une **fonctionnalité à construire** (modèle + endpoints + notif). Si non, retirer `isPrivateAccount` du périmètre produit.
2. **EVEN-08 — Annulation d'event :** faut-il un état `CANCELED` distinct de `ENDED` en base (impact feed/historique/notif) ?
3. **PART-08 — Unban :** un endpoint de levée de ban room est-il attendu côté produit ?

### Ordre de correction recommandé

1. **Immédiat (🔴/sécurité argent & RGPD) :** PAYM-03, PAYM-05, PAYM-04, MODE-01.
2. **Sprint courant (RBAC/confidentialité) :** ROOM-01/PART-01, PART-02/03, CLUB-01/02/03, RECO-02, AUTH-01/02/03, RECO-01.
3. **Suivant (intégrité extensions↔legacy) :** unifier les chemins speakInvite/clubreq sur le legacy (PART-04, HAND-02/03/04/05), FOLL-02/03.
4. **Backlog (idempotence/concurrence/UX) :** l'ensemble des mineures, par lot et par module.

### Anomalies rejetées après vérification (transparence)

- **RECO-03** (double egress facturable au démarrage concurrent) : rejetée — la dédup et le verrou couvrent le cas dans la pratique.
- **PAYM-09** (race KYC sur le mapping Redis) : rejetée — le write est suffisamment encadré.

---

_Rapport généré par audit multi-agents (cartographie → chasse adversariale → vérification par relecture). 101 sous-agents, ~3,9 M tokens. Chaque anomalie listée a été re-confirmée par relecture du code à l'emplacement cité._
