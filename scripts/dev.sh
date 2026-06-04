#!/usr/bin/env bash
# Bring up the full local dev stack: Postgres, Redis, backend (extended),
# Metro tunnel. Idempotent — re-runnable.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "▶ 1/4 — Starting Docker services (Postgres + Redis)"
docker compose -f backend/docker-compose.yml up -d postgres redis
echo "  waiting for healthy state..."
for i in $(seq 1 30); do
  pg=$(docker inspect -f '{{.State.Health.Status}}' chathouse-postgres 2>/dev/null || echo "n/a")
  rd=$(docker inspect -f '{{.State.Health.Status}}' chathouse-redis 2>/dev/null || echo "n/a")
  if [ "$pg" = "healthy" ] && [ "$rd" = "healthy" ]; then break; fi
  sleep 2
done
echo "  Postgres=$pg, Redis=$rd"

echo "▶ 2/4 — Applying Prisma migrations"
(cd backend && npx prisma migrate deploy)

echo "▶ 3/4 — Starting backend (extended — all 7 vagues)"
(cd backend && nohup npx tsx src/extensions/server.ts > /tmp/chathouse-backend.log 2>&1 &)
echo "  log: tail -f /tmp/chathouse-backend.log"

echo "▶ 4/4 — Starting Metro (LAN mode)"
(nohup npx expo start --go --host lan > /tmp/expo.log 2>&1 &)
echo "  log: tail -f /tmp/expo.log"
echo ""
echo "Stack up. Open Expo Go and scan the QR shown in the Metro log."
