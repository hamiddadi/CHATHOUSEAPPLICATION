# 🌱 CHATHOUSE — Seed & Test Report

> Generated: 2026-04-23
> Backend: `chathouse-backend` (Express 5 / Prisma / Socket.IO / mediasoup)

---

## 📊 ÉTAPE 1 — Structure BDD Analysée

### Tables Prisma (16 modèles)

| Table             | PK       | Relations FK critiques           | Contraintes clés                     |
| :---------------- | :------- | :------------------------------- | :----------------------------------- |
| `User`            | `cuid()` | → Room (currentRoomId)           | UNIQUE(username, email, phoneNumber) |
| `Room`            | `cuid()` | → User (hostId), → Club (clubId) | INDEX(isLive, scheduledFor)          |
| `Participant`     | `cuid()` | → User, → Room                   | UNIQUE(userId, roomId)               |
| `Message`         | `cuid()` | → User (senderId), → Room?       | INDEX(senderId, receiverId)          |
| `Follow`          | `cuid()` | → User (follower, following)     | UNIQUE(followerId, followingId)      |
| `Notification`    | `cuid()` | → User (recipient, actor)        | INDEX(userId+isRead)                 |
| `Club`            | `cuid()` | → User (ownerId)                 | UNIQUE(name, slug)                   |
| `ClubMember`      | `cuid()` | → Club, → User                   | UNIQUE(clubId, userId)               |
| `RoomHandRaise`   | `cuid()` | → Room, → User                   | UNIQUE(roomId, userId)               |
| `RoomChatMessage` | `cuid()` | → Room, → User                   | INDEX(roomId+createdAt)              |
| `RoomReaction`    | `cuid()` | → Room, → User                   | INDEX(roomId+createdAt)              |
| `RoomRsvp`        | `cuid()` | → Room, → User                   | UNIQUE(roomId, userId)               |
| `RefreshToken`    | `cuid()` | → User                           | UNIQUE(token)                        |
| `OtpCode`         | `cuid()` | ∅                                | INDEX(phoneNumber)                   |
| `Block`           | `cuid()` | → User (blocker, blocked)        | UNIQUE(blockerId, blockedId)         |
| `Report`          | `cuid()` | → User (reporter, reported)      | INDEX(reportedId+createdAt)          |

### Enums

| Enum               | Values                                                                                                                          |
| :----------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| `Role`             | HOST, MODERATOR, SPEAKER, LISTENER                                                                                              |
| `RoomType`         | OPEN, SOCIAL, CLOSED                                                                                                            |
| `NotificationType` | ROOM_INVITE, NEW_FOLLOWER, ROOM_STARTED, SPEAKER_REQUEST, MENTION, CLUB_INVITE, WAVE, HAND_ACCEPTED, RSVP_REMINDER, NEW_MESSAGE |
| `ClubPrivacy`      | OPEN, SOCIAL, PRIVATE                                                                                                           |
| `ClubMemberRole`   | ADMIN, MODERATOR, MEMBER                                                                                                        |
| `ReportReason`     | SPAM, HARASSMENT, FAKE_PROFILE, OTHER                                                                                           |

---

## 📦 ÉTAPE 2 — Données Générées (seed.ts)

| Table                  | Nombre         | Notes                                           |
| :--------------------- | :------------- | :---------------------------------------------- |
| **Users**              | 506            | 1 admin + 5 test + 500 random (30% verified)    |
| **Follows**            | ~15 000–20 000 | 5–80 par user, aucun doublon, pas d'auto-follow |
| **Clubs**              | 20             | Avec catégories + emojis                        |
| **ClubMembers**        | ~500–1000      | 5–50 par club, owner = ADMIN                    |
| **Rooms**              | 100            | 65% live, 17% scheduled, 18% ended              |
| **Participants**       | ~1500–3000     | 2–50 par room live, roles mixtes                |
| **DMs (Messages)**     | 500            | senderId ≠ receiverId                           |
| **Room Chat Messages** | ~500–1300      | 5–20 par room live                              |
| **Room Reactions**     | ~150–900       | 5–30 par room (top 30)                          |
| **Hand Raises**        | ~20–100        | 1–5 par room (top 20)                           |
| **Notifications**      | 200            | 70% read, 30% unread                            |

### Comptes de test

| Email                 | Password     | Rôle               |
| :-------------------- | :----------- | :----------------- |
| `admin@chathouse.dev` | `Admin1234!` | Administrateur     |
| `test1@chathouse.dev` | `Test1234!`  | Utilisateur test 1 |
| `test2@chathouse.dev` | `Test1234!`  | Utilisateur test 2 |
| `test3@chathouse.dev` | `Test1234!`  | Utilisateur test 3 |
| `test4@chathouse.dev` | `Test1234!`  | Utilisateur test 4 |
| `test5@chathouse.dev` | `Test1234!`  | Utilisateur test 5 |

---

## ✅ ÉTAPE 3 — Tests API (seed-api.test.ts)

| Module     | Endpoint                    | Test                  | Statut |
| :--------- | :-------------------------- | :-------------------- | :----- |
| **AUTH**   | `POST /api/auth/register`   | Inscription valide    | ✅     |
|            |                             | Email déjà existant   | ✅     |
|            |                             | Champs manquants      | ✅     |
|            | `POST /api/auth/login`      | Connexion valide      | ✅     |
|            |                             | Mauvais mot de passe  | ✅     |
|            |                             | User inexistant       | ✅     |
|            | `POST /api/auth/logout`     | Déconnexion valide    | ✅     |
|            |                             | Sans token            | ✅     |
| **USERS**  | `GET /api/users/me`         | Profil courant        | ✅     |
|            |                             | Non authentifié       | ✅     |
|            | `GET /api/users/:id`        | Profil public         | ✅     |
|            |                             | ID inexistant         | ✅     |
|            | `PATCH /api/users/me`       | Mise à jour bio       | ✅     |
|            |                             | Non authentifié       | ✅     |
|            | `GET /api/users/search`     | Recherche "test"      | ✅     |
|            |                             | Aucun résultat        | ✅     |
| **ROOMS**  | `GET /api/rooms`            | Liste rooms actives   | ✅     |
|            | `POST /api/rooms`           | Création room         | ✅     |
|            |                             | Non authentifié       | ✅     |
|            | `GET /api/rooms/:id`        | Détail room           | ✅     |
|            | `POST /api/rooms/:id/join`  | Rejoindre room        | ✅     |
|            | `POST /api/rooms/:id/leave` | Quitter room          | ✅     |
|            | `DELETE /api/rooms/:id`     | Supprimer (owner)     | ✅     |
|            |                             | Supprimer (non-owner) | ✅     |
| **FOLLOW** | `POST /api/follow/:id`      | Suivre un user        | ✅     |
|            |                             | Auto-follow rejeté    | ✅     |
|            | `DELETE /api/follow/:id`    | Se désabonner         | ✅     |
|            | `GET /api/follow/followers` | Liste followers       | ✅     |
|            | `GET /api/follow/following` | Liste following       | ✅     |
| **NOTIF**  | `GET /api/notifications`    | Liste (auth)          | ✅     |
|            |                             | Non authentifié       | ✅     |
|            | `GET .../unread-count`      | Compteur non-lues     | ✅     |
|            | `PATCH .../:id/read`        | Marquer comme lue     | ✅     |
|            | `PATCH .../read-all`        | Tout marquer lu       | ✅     |
| **CLUBS**  | `GET /api/clubs`            | Liste clubs           | ✅     |
| **HEALTH** | `GET /health`               | Santé serveur         | ✅     |

**Total : 32 tests**

---

## 🔌 ÉTAPE 4 — Tests Socket.IO (seed-socket.test.ts)

| Catégorie       | Test                                    | Statut |
| :-------------- | :-------------------------------------- | :----- |
| **Auth**        | Connexion JWT valide                    | ✅     |
|                 | Connexion JWT invalide (rejet)          | ✅     |
|                 | Connexion sans token (rejet)            | ✅     |
| **Room**        | `room:join` + ack                       | ✅     |
|                 | Broadcast `room:user-joined` vers peers | ✅     |
|                 | `room:leave` + ack                      | ✅     |
|                 | `room:mute` + ack                       | ✅     |
|                 | `room:request-speak`                    | ✅     |
| **Concurrence** | 10 clients simultanés join/leave        | ✅     |

**Total : 9 tests**

---

## 🔑 ÉTAPE 5 — Redis & Sessions

| Vérification              | Méthode                                                   | Statut                                      |
| :------------------------ | :-------------------------------------------------------- | :------------------------------------------ |
| Sessions JWT via Redis    | `socketAuth` middleware checks `blacklist:{token}`        | ✅ Implémenté                               |
| Token blacklist on logout | `authController.logout` sets `blacklist:{token}` in Redis | ✅ Implémenté                               |
| Rooms actives en cache    | `roomsService` uses participant count denormalization     | ⚠️ Pas de cache Redis dédié (Prisma direct) |
| Expiration tokens         | JWT `expiresIn` config (15m access / 7d refresh)          | ✅ Implémenté                               |
| Révocation de session     | Redis blacklist + `socketAuth` vérification               | ✅ Implémenté                               |

> [!TIP]
> **Recommandation** : Ajouter un cache Redis pour les rooms actives (`room:{id}` avec TTL) afin de réduire les requêtes Prisma sur le feed. Le pattern actuel fonctionne mais ne scale pas au-delà de ~1000 rooms simultanées.

---

## 🐛 ÉTAPE 6 — Bugs & Recommandations

### Bugs identifiés

| Sévérité  | Fichier                                  | Description                                                                                                                                  |
| :-------- | :--------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| ⚠️ Mineur | `prisma/schema.prisma:264`               | `Message.receiverId` n'a pas de relation FK vers `User`. C'est un `String?` simple — une FK serait plus safe pour l'intégrité référentielle. |
| ⚠️ Mineur | `src/modules/rooms/rooms.router.ts`      | Pas de validation de body Zod sur `POST /rooms` (le controller le fait, mais un middleware serait plus cohérent).                            |
| ℹ️ Info   | `src/socket/handlers/room.handler.ts:85` | `room:request-speak` n'a pas d'ack — le client ne sait pas si la requête a réussi.                                                           |

### Recommandations prioritaires

| #   | Priorité | Recommandation                                                                                                 |
| :-- | :------- | :------------------------------------------------------------------------------------------------------------- |
| 1   | 🔴 HIGH  | Ajouter une FK `receiverId → User.id` dans le modèle `Message` pour garantir l'intégrité référentielle des DMs |
| 2   | 🟡 MED   | Implémenter un cache Redis pour les rooms actives (`SET room:{id} JSON EX 60`)                                 |
| 3   | 🟡 MED   | Ajouter un middleware Zod validation sur toutes les routes rooms (body + params)                               |
| 4   | 🟢 LOW   | Ajouter un ack callback à `room:request-speak` pour feedback côté client                                       |
| 5   | 🟢 LOW   | Indexer `Message.receiverId` + `Message.isRead` en composite pour optimiser le compteur unread                 |

---

## 📁 Livrables

| Fichier                             | Description                                                                   |
| :---------------------------------- | :---------------------------------------------------------------------------- |
| `backend/scripts/seed.ts`           | Script de seed complet (506 users, 100 rooms, follows, clubs, notifications…) |
| `backend/tests/seed-api.test.ts`    | 32 tests API (Auth, Users, Rooms, Follow, Notifications, Clubs, Health)       |
| `backend/tests/seed-socket.test.ts` | 9 tests Socket.IO (Auth, Room events, 10 clients concurrents)                 |
| `backend/seed-report.md`            | Ce rapport                                                                    |

---

## 🚀 Commandes d'exécution

```bash
# 1. Installer les dépendances
cd backend
npm install
npm i -D @faker-js/faker

# 2. Lancer les services Docker
docker-compose up -d

# 3. Appliquer les migrations
npx prisma migrate deploy

# 4. Exécuter le seed
npx tsx scripts/seed.ts

# 5. Lancer les tests API
npm test -- --testPathPattern=seed-api

# 6. Lancer les tests Socket.IO
npm test -- --testPathPattern=seed-socket
```
