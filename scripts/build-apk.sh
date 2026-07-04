#!/usr/bin/env bash
# Build a ChatHouse APK entirely inside Docker (no Java / Android SDK / Node.js).
# Usage:
#   scripts/build-apk.sh                 # auto-detect LAN IP
#   scripts/build-apk.sh 192.168.1.42    # explicit backend host
#   APK_ABIS="arm64-v8a,armeabi-v7a" scripts/build-apk.sh 192.168.1.42
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"

LAN_IP="${1:-}"
if [ -z "${LAN_IP}" ]; then
  # Linux: first non-loopback IPv4; macOS: Wi-Fi/en0 address.
  if command -v ip >/dev/null 2>&1; then
    LAN_IP="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | grep -v '^169\.254' | head -n1)"
  fi
  if [ -z "${LAN_IP}" ] && command -v ipconfig >/dev/null 2>&1; then
    LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  fi
  [ -n "${LAN_IP}" ] && echo "Auto-detected LAN IP: ${LAN_IP}  (override: scripts/build-apk.sh <ip>)"
fi
[ -n "${LAN_IP}" ] || { echo "Could not auto-detect a LAN IP. Pass it: scripts/build-apk.sh <your PC IP>" >&2; exit 1; }

mkdir -p "${REPO}/artifacts"
echo "Building ChatHouse APK -> backend http://${LAN_IP}:4000  (ABIs: ${APK_ABIS:-arm64-v8a})"
BACKEND_HOST="${LAN_IP}" \
APK_ABIS="${APK_ABIS:-arm64-v8a}" \
GOOGLE_MAPS_API_KEY="${GOOGLE_MAPS_API_KEY:-}" \
  docker compose -f "${REPO}/docker-compose.apk.yml" run --rm apk-builder

echo
echo "APK ready in: ${REPO}/artifacts"
ls -lh "${REPO}/artifacts"/*.apk 2>/dev/null || true
