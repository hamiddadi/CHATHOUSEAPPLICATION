# backend/src/modules

15 domain modules, each following the Fastify-style triple:

```
<module>/
├── <module>.router.ts      Express router (auth + asyncHandler wiring)
├── <module>.controller.ts  HTTP request handlers
├── <module>.service.ts     Business logic + Prisma access
├── <module>.schema.ts      Zod input validation (optional)
```

| Module          | Purpose                                 | Notable socket events                    |
| --------------- | --------------------------------------- | ---------------------------------------- |
| `auth`          | Login, OTP, refresh, password reset     | —                                        |
| `users`         | Profile CRUD, blocks, reports           | `user:follower_count`                    |
| `follow`        | Follow/unfollow, lists                  | `user:follower_count`                    |
| `rooms`         | CRUD + join/leave + RSVP + moderation   | `hallway:*`, `room:*`                    |
| `chat`          | Direct messages (1:1)                   | `notification:new`                       |
| `maps`          | Geo presence ("ghost mode" toggle)      | `maps:*`                                 |
| `notifications` | List, mark-read, preferences            | `notification:new`, `notification:count` |
| `clubs`         | Club CRUD + members + invites           | —                                        |
| `search`        | Trigram search across users/clubs/rooms | —                                        |
| `explore`       | Trending feed                           | —                                        |
| `push`          | FCM/Expo push token registration        | —                                        |
| `admin`         | Godmode (reports, audits, role changes) | —                                        |
| `social`        | Block-aware utility                     | —                                        |
| `otp`           | OTP code lifecycle                      | —                                        |

## Extensions

`backend/src/extensions/modules/` mirrors this folder for additive vagues
(suggestions, contacts, presence, topics, events, chatmod, privacy,
searchext, audio, netquality, clubreq, payments, captions, twitter).
They follow the same triple and reuse `requireAuth`, `prisma`, `asyncHandler`
without modifying anything here.

## Conventions

- Routes are mounted in `backend/src/app.ts → createApp()`. New modules
  must be imported there OR registered via `mountExtensions(app)` in
  `backend/src/extensions/mount.ts`.
- Errors throw `AppError` (registered codes in
  `middlewares/error.middleware.ts`).
- Long-running work is offloaded to BullMQ queues under `backend/src/queues/`.
