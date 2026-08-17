# ChatHouse

ChatHouse is a bare React Native audio-social application with native Android
and iOS projects plus an Express/Prisma backend.

## Stack

- React Native 0.83.6, React 19.2 and strict TypeScript
- Android (Kotlin, SDK 36, Hermes, new architecture)
- iOS (Swift, CocoaPods, Hermes, new architecture)
- React Navigation, Zustand, TanStack Query, React Hook Form and Zod
- LiveKit audio, Firebase Cloud Messaging, Notifee and Sentry
- Express 5, Socket.IO, Prisma/PostgreSQL and Redis

## Prerequisites

- Node.js `>=22.20.0 <23` and npm
- Android: JDK 17 and Android SDK 36
- iOS: macOS, Xcode and Bundler/CocoaPods
- Docker Desktop for the backend and integration tests

## Install

```bash
npm ci
cd backend && npm ci
```

Copy `.env.example` to `.env`, and `backend/.env.example` to
`backend/.env`. Do not use localhost in the mobile `.env` when running on a
physical device; use the development machine's LAN address.

Firebase native configuration is intentionally not committed:

```bash
cp android/app/google-services.json.example android/app/google-services.json
cp ios/ChatHouse/GoogleService-Info.plist.example ios/ChatHouse/GoogleService-Info.plist
```

Replace both placeholders with files downloaded from the Firebase console.

## Run

```bash
# Terminal 1
npm run backend:up

# Terminal 2
cd backend
npm run prisma:deploy
npm run dev

# Terminal 3
npm start

# Terminal 4 — choose one platform
npm run android
npm run ios
```

On macOS, run `npm run ios:pods` after installing or changing native
dependencies.

## Quality and tests

```bash
npm run quality
npm test

cd backend
npm run lint
npm run typecheck
npm run test:local
```

`test:local` starts disposable PostgreSQL/Redis test services on ports 5434 and
6380, applies migrations to `chathouse_test`, and then runs Jest. A safety guard
refuses any database whose name does not contain `test`.

## Native release

- Android release signing: [`docs/RELEASE-SIGNING.md`](docs/RELEASE-SIGNING.md)
- Native setup: [`docs/setup.md`](docs/setup.md)
- Store builds: [`docs/store/build-and-submit.md`](docs/store/build-and-submit.md)
- Go-live checklist: [`docs/GO-LIVE.md`](docs/GO-LIVE.md)
- Legal release dossier: [`docs/legal/README.md`](docs/legal/README.md)

The CI verifies lint (including CSS/NativeWind and operational shell scripts),
formatting, TypeScript, Jest, Compose rendering, backend migrations/tests,
backup/restore contracts, Android assemble/lint, and an iOS Simulator build.

## Architecture

The app is organized by feature. Each domain owns its screens, components,
hooks, services, state and types; reusable infrastructure lives under `shared`
and application composition under `core`.

```text
src/
├── core/       navigation, providers, i18n and observability
├── features/   auth, rooms, houses, messages, maps, profile, settings, …
├── shared/     components, API/realtime clients, hooks, types and utilities
├── config/     validated build-time environment
└── assets/
```

See [`docs/architecture.md`](docs/architecture.md) for the detailed boundaries.
