#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# health-check.sh — post-deploy smoke test for the ChatHouse API.
#
# Probes the three endpoints that actually exist on the API and asserts the
# expected status / payload:
#   1. GET /health        → 200, JSON services.database == true && services.redis == true
#   2. GET /health/live   → 200, JSON status == "alive"
#   3. GET /api/users/me  → 401 (no bearer token → unauthorized)
#
# Retries up to MAX_ATTEMPTS with exponential backoff so a container that is
# still warming up (mediasoup workers spawning, Prisma connecting) does not
# cause a false failure.
#
# Usage:
#   BASE_URL=http://localhost:4000 ./health-check.sh
#   ./health-check.sh http://staging.internal:4000     # arg 1 overrides BASE_URL
#
# Env:
#   BASE_URL       base URL of the API           (default http://localhost:4000)
#   MAX_ATTEMPTS   number of retries             (default 10)
#   BACKOFF_BASE   initial backoff seconds       (default 2; capped at 30)
#
# Exit: 0 = all checks passed; 1 = failure (CD uses this to trigger rollback).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

log() { printf '%s [health-check] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

BASE_URL="${1:-${BASE_URL:-http://localhost:4000}}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-10}"
BACKOFF_BASE="${BACKOFF_BASE:-2}"
BACKOFF_CAP=30

# jq is nice-to-have; fall back to grep on the raw JSON when it's missing.
HAVE_JQ=0
if command -v jq >/dev/null 2>&1; then HAVE_JQ=1; fi

# http_status URL  → prints the HTTP status code, body saved to $BODY_FILE.
BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

http_status() {
  local url="$1"
  curl -fsS -o "$BODY_FILE" -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || echo "000"
}

# json_true KEY  → 0 if services.KEY is true in $BODY_FILE, else 1.
json_true() {
  local key="$1"
  if [ "$HAVE_JQ" -eq 1 ]; then
    [ "$(jq -r ".services.${key}" "$BODY_FILE" 2>/dev/null)" = "true" ]
  else
    grep -Eq "\"${key}\"[[:space:]]*:[[:space:]]*true" "$BODY_FILE"
  fi
}

# json_eq PATH VALUE  → 0 if JSON PATH equals VALUE.
json_eq() {
  local path="$1" want="$2"
  if [ "$HAVE_JQ" -eq 1 ]; then
    [ "$(jq -r "$path" "$BODY_FILE" 2>/dev/null)" = "$want" ]
  else
    grep -Eq "\"${path##*.}\"[[:space:]]*:[[:space:]]*\"${want}\"" "$BODY_FILE"
  fi
}

run_checks() {
  local code

  # 1) /health → 200 with db + redis healthy.
  code="$(http_status "${BASE_URL}/health")"
  if [ "$code" != "200" ]; then
    log "FAIL  GET /health → http ${code} (want 200)"
    return 1
  fi
  if ! json_true database; then
    log "FAIL  GET /health → services.database is not true"
    return 1
  fi
  if ! json_true redis; then
    log "FAIL  GET /health → services.redis is not true"
    return 1
  fi
  log "PASS  GET /health → 200, database+redis healthy"

  # 2) /health/live → 200, status alive.
  code="$(http_status "${BASE_URL}/health/live")"
  if [ "$code" != "200" ]; then
    log "FAIL  GET /health/live → http ${code} (want 200)"
    return 1
  fi
  if ! json_eq '.status' 'alive'; then
    log "FAIL  GET /health/live → status is not \"alive\""
    return 1
  fi
  log "PASS  GET /health/live → 200, status=alive"

  # 3) /api/users/me without a token → 401.
  code="$(http_status "${BASE_URL}/api/users/me")"
  if [ "$code" != "401" ]; then
    log "FAIL  GET /api/users/me → http ${code} (want 401)"
    return 1
  fi
  log "PASS  GET /api/users/me → 401 (unauthorized as expected)"

  return 0
}

log "Target: ${BASE_URL} (max_attempts=${MAX_ATTEMPTS}, jq=${HAVE_JQ})"

backoff="$BACKOFF_BASE"
for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  log "Attempt ${attempt}/${MAX_ATTEMPTS}"
  if run_checks; then
    log "All health checks PASSED"
    exit 0
  fi
  if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
    log "Retrying in ${backoff}s"
    sleep "$backoff"
    backoff=$(( backoff * 2 ))
    [ "$backoff" -gt "$BACKOFF_CAP" ] && backoff="$BACKOFF_CAP"
  fi
done

log "Health checks FAILED after ${MAX_ATTEMPTS} attempts"
exit 1
