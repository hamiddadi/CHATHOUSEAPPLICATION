# API Reference

Live Swagger UI : `http://localhost:4000/api/docs/`

## Authentication

Every protected endpoint expects `Authorization: Bearer <JWT>`. Tokens are
issued by `POST /api/auth/login` and refreshed via `POST /api/auth/refresh`.

## Legacy endpoints (existing)

| Prefix                 | Module                                               |
| ---------------------- | ---------------------------------------------------- |
| `/api/auth/*`          | Login, OTP, refresh, logout, password reset          |
| `/api/users/*`         | Profile CRUD, blocks, reports                        |
| `/api/follow/*`        | Follow/unfollow, followers list                      |
| `/api/rooms/*`         | Create / join / leave, RSVPs, hand raise, kick, mute |
| `/api/chat/*`          | Direct messages                                      |
| `/api/maps/*`          | Geo presence                                         |
| `/api/notifications/*` | List, mark-read, preferences                         |
| `/api/clubs/*`         | Club CRUD, members, invitations                      |
| `/api/search/*`        | Universal search (users, clubs, rooms)               |
| `/api/explore/*`       | Trending feed                                        |
| `/api/push/*`          | Push token registration                              |
| `/api/admin/*`         | Godmode (gated by `appRole>=MODERATOR`)              |

## Extension endpoints (7 vagues — additive)

Mounted only when starting via `backend/src/extensions/server.ts` :

| Prefix                          | Vague | Purpose                         |
| ------------------------------- | ----- | ------------------------------- |
| `/api/ext/suggestions`          | v1    | Suggested follows               |
| `/api/ext/contacts`             | v1    | Phone-hash contacts sync        |
| `/api/ext/presence`             | v1    | "People available to chat"      |
| `/api/ext/topics`               | v1    | 150+ topics taxonomy            |
| `/api/ext/events/:id/cancel`    | v2    | Cancel scheduled event          |
| `/api/ext/chatmod/messages/:id` | v2    | Soft-delete chat message        |
| `/api/ext/privacy`              | v3    | GET/PATCH privacy settings      |
| `/api/ext/search/rooms`         | v3    | Filter rooms by language/topic  |
| `/api/ext/audio`                | v4    | Audio quality tier prefs        |
| `/api/ext/netquality`           | v4    | Network quality reports         |
| `/api/ext/clubreq`              | v5    | Club join requests workflow     |
| `/api/ext/payments`             | v7    | Stripe Connect (flagged by env) |
| `/api/ext/captions`             | v7    | Live captions (flagged by env)  |
| `/api/ext/twitter`              | v7    | OAuth import (flagged by env)   |

## Response envelope

```json
{ "success": true, "data": { ... } }
```

Errors :

```json
{ "success": false, "error": { "code": "AUTH_003", "message": "Unauthorized" } }
```

Error codes are listed in `backend/src/middlewares/error.middleware.ts`.
