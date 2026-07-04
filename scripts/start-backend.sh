#!/usr/bin/env bash
# Start the ChatHouse backend (Postgres + Redis + API + LiveKit) in Docker.
# Requires ONLY Docker. Auto-detects your LAN IP for phone-reachable live audio.
# Usage:
#   scripts/start-backend.sh                # up, auto LAN IP
#   scripts/start-backend.sh 192.168.1.42   # up, explicit LAN IP
#   scripts/start-backend.sh --down         # stop everything
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="${REPO}/backend/docker-compose.yml"

if [ "${1:-}" = "--down" ]; then
  docker compose -f "${COMPOSE}" down
  exit 0
fi

LAN_IP="${1:-}"
if [ -z "${LAN_IP}" ]; then
  if command -v ip >/dev/null 2>&1; then
    LAN_IP="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | grep -v '^169\.254' | head -n1)"
  fi
  if [ -z "${LAN_IP}" ] && command -v ipconfig >/dev/null 2>&1; then
    LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  fi
  [ -n "${LAN_IP}" ] && echo "Auto-detected LAN IP: ${LAN_IP}  (override: scripts/start-backend.sh <ip>)"
fi
[ -n "${LAN_IP}" ] || { echo "Could not auto-detect a LAN IP. Pass it: scripts/start-backend.sh <your PC IP>" >&2; exit 1; }

echo "Starting ChatHouse backend (LAN_IP=${LAN_IP}) ..."
LAN_IP="${LAN_IP}" docker compose -f "${COMPOSE}" up -d

echo
echo "Backend up. Verify:  curl http://${LAN_IP}:4000/health"
echo "Build a matching APK: scripts/build-apk.sh ${LAN_IP}"
