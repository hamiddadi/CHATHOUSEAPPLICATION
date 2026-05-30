# Setup Guide

## Prerequisites

- **Node.js 20.x** (`>=20 <21` per backend `package.json` engines)
- **pnpm** or **npm** (the repo uses npm with `--no-save` for ad-hoc tools)
- **Docker Desktop** (for Postgres + Redis via compose)
- **Expo Go** on iPhone/Android — must be the **SDK 55** build

## 1. Install dependencies

```bash
# Frontend
cd <repo>
npm install

# Backend
cd backend
npm install
```

## 2. Configure env vars

```bash
cp .env.example .env            # frontend
cp backend/.env.example backend/.env
```

Minimum required keys in `.env` (frontend):

```bash
API_BASE_URL=http://<LAN-IP>:4000/api
WS_BASE_URL=ws://<LAN-IP>:4000
REALTIME_ENABLED=true
AGORA_APP_ID=<from Agora dashboard, optional>
```

Minimum required in `backend/.env`:

```bash
DATABASE_URL=postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public
REDIS_URL=redis://localhost:6379
JWT_SECRET=<32+ random chars>
PORT=4000
HOST=0.0.0.0
```

Optional env (feature-flagged extensions):

```bash
# Vague 7 — Stripe Connect
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_CONNECT_CLIENT_ID=ca_xxx
STRIPE_RETURN_URL=https://app.chathouse.com/payments/return
STRIPE_REFRESH_URL=https://app.chathouse.com/payments/refresh

# Vague 7 — Live captions
ASR_PROVIDER=whisper
ASR_API_KEY=sk-xxx

# Vague 7 — Twitter import
TWITTER_CLIENT_ID=xxx
TWITTER_CLIENT_SECRET=xxx
TWITTER_REDIRECT_URI=chathouse://oauth/twitter

# Vague 1 — Contacts hashing salt
CONTACTS_HASH_SALT=<random 32+ chars>
```

## 3. Boot the database

```bash
cd backend
docker compose up -d            # spins up postgres on :5433, redis on :6379
npx prisma migrate dev          # apply migrations on first boot
npm run seed                    # optional dev data
```

## 4. Start the backend

Two flavors :

```bash
# Legacy stack (no extensions)
npm run dev

# Extended stack (all 7 vagues mounted under /api/ext/*)
npx tsx src/extensions/server.ts
```

Both listen on `http://0.0.0.0:4000`.

## 5. Start the mobile app

```bash
cd <repo>

# LAN mode (phone on same Wi-Fi)
REACT_NATIVE_PACKAGER_HOSTNAME=<LAN-IP> npx expo start --go --host lan

# Tunnel mode (works through public internet — requires ngrok account)
npx expo start --go --tunnel
```

Scan the QR with Expo Go.

## Troubleshooting

| Symptom                            | Likely cause                          | Fix                                       |
| ---------------------------------- | ------------------------------------- | ----------------------------------------- |
| `Failed to download remote update` | Phone can't reach Metro               | Same Wi-Fi + firewall TCP/8081 + TCP/4000 |
| "Client isolation" on guest Wi-Fi  | Router blocks peer-to-peer            | Use mobile hotspot OR tunnel mode         |
| `Cannot find module @sindresorhus` | Metro watcher race during npm install | Restart `expo start` with `CI=1`          |
| Backend port already in use        | Old Docker container                  | `docker stop chathouse-api`               |
| Mediasoup fails to init            | Not built for current Node            | Set `MEDIASOUP_ENABLED=false`             |
