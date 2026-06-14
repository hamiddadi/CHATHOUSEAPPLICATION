# Architecture — Chathouse

> Last updated: 2026-05-26

## Overview

Chathouse is a Clubhouse-style social audio platform composed of three logical tiers:

```
┌─────────────────────┐   HTTPS / WSS    ┌──────────────────────┐
│   React Native app  │ ───────────────► │  Backend (Fastify +  │
│   (bare RN 0.83)    │ ◄─────────────── │  socket.io + Prisma) │
└─────────┬───────────┘                  └─────────┬────────────┘
          │                                        │
          │           SRTP / DTLS                  │
          │   (LiveKit / WebRTC SRTP media —       │
          │    native dev or release build,        │
          │    not a JS-only run)                  │
          ▼                                        ▼
┌─────────────────────┐                  ┌──────────────────────┐
│  Native audio stack │                  │ PostgreSQL + Redis   │
│  (mediasoup / Agora)│                  │ (Docker compose)     │
└─────────────────────┘                  └──────────────────────┘
```

## Frontend layout

The mobile app lives under `src/` at the repo root (no `mobile/` wrapper).
Feature folders follow the same shape:

```
src/features/<domain>/
├── screens/
├── components/
├── hooks/
├── services/
├── store/
├── types/
└── index.ts          (barrel)
```

Cross-feature primitives live under `src/shared/`. The navigation tree is in
`src/core/navigation/`. Path aliases (`@features/*`, `@core/*`, `@shared/*`,
`@config/*`, `@assets/*`) are defined in `tsconfig.json`.

### Extension layer

`src/features/extensions/` hosts the "Clubhouse-parity" additions that were
delivered without touching the legacy code (see `backend/src/extensions/`).
The 7 vagues are documented in `backend/src/extensions/DELIVERY-FINAL.md`.

## Backend layout

```
backend/src/
├── app.ts            (Express assembly — createApp())
├── config/           (env, logger, database, redis, mediasoup)
├── modules/<domain>/ (controller + service + router + schema)
├── middlewares/      (auth, error, rate-limit)
├── routes/           (health, docs)
├── socket/           (gateway, handlers, realtime fan-out)
├── webrtc/           (mediasoup manager + authz)
├── queues/           (BullMQ workers — events, location)
├── extensions/       (Clubhouse-parity 7 vagues — additive)
└── utils/
```

The backend uses **Fastify-style Express routers** (not NestJS modules)
because of the existing investment; the structure mirrors NestJS's
module/controller/service split without the decorator overhead.

## Persistence

- **PostgreSQL 16** holds all relational state (users, rooms, club members,
  notifications, audit logs). Schema source: `backend/prisma/schema.prisma`.
- **Redis** caches presence, follower fan-out idempotency, audio prefs,
  netquality reports, and club join requests.

## Real-time

- **socket.io** for hand-raises, chat, role changes, hallway updates.
  Event constants are in `backend/src/socket/realtime.ts`.
- **mediasoup** as the SFU for audio (gated by `MEDIASOUP_ENABLED` env).

## Background workers

- `event-reminders` — 5-min pre-event push (legacy)
- `ext-event-reminders-15` — 15-min pre-event push (Vague 2 extension)
- `ext.fanout` — "follow started a room" fan-out (Vague 3 extension)
- `location-purge` — periodic GDPR purge

## Build / Deploy

- Frontend: bare React Native (de-Expo) — Android built with Gradle
  (`./gradlew :app:assembleDebug` / `:app:bundleRelease`); live audio = LiveKit.
  See [`docs/RELEASE-SIGNING.md`](./RELEASE-SIGNING.md).
- Backend: `tsc -p tsconfig.build.json` → `node dist/app.js` or
  `dist/extensions/server.js` for the extended stack.
- Docker compose at `backend/docker-compose.yml` for local Postgres+Redis.
