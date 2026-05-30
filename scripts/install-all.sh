#!/usr/bin/env bash
# One-command bootstrap for the whole repo. Pseudo-monorepo: the root is the
# Expo app, backend/ is a sibling Node service. We avoid `npm workspaces`
# because Metro resolution gets ambiguous when both roots ship react / RN.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "▶ Installing frontend (Expo) dependencies..."
cd "$ROOT" && npm install

echo "▶ Installing backend dependencies..."
cd "$ROOT/backend" && npm install

echo "▶ Generating Prisma client..."
cd "$ROOT/backend" && npx prisma generate

echo ""
echo "Done. Next steps:"
echo "  - cp .env.example .env             (configure frontend)"
echo "  - cp backend/.env.example backend/.env  (configure backend)"
echo "  - bash scripts/dev.sh              (boot the stack)"
