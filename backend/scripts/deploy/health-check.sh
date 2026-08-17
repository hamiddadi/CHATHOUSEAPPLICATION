#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# health-check.sh — post-deploy smoke test for the ChatHouse API.
#
# Probes the three internal API endpoints and, when explicitly enabled, the
# public HTTPS resources required by the stores:
#   1. GET /health        → 200, JSON services.database == true && services.redis == true
#   2. GET /health/live   → 200, JSON status == "alive"
#   3. GET /api/users/me  → 401 (no bearer token → unauthorized)
#   4. GET the public support, privacy, terms and deletion pages → 200, expected HTML
#   5. GET $PUBLIC_APP_URL/.well-known/assetlinks.json → production association
#   6. GET $PUBLIC_APP_URL/.well-known/apple-app-site-association → production association
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
#   CONNECT_TIMEOUT TCP connection timeout       (default 3 seconds)
#   REQUEST_TIMEOUT whole request timeout        (default 10 seconds)
#   REQUIRE_PUBLIC_ENDPOINTS fail unless both public URLs are supplied (default false)
#   PUBLIC_API_URL public HTTPS API origin (no path)
#   PUBLIC_APP_URL public HTTPS Universal/App Links origin (no path)
#
# Exit: 0 = all checks passed; 1 = failure (CD uses this to trigger rollback).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

log() { printf '%s [health-check] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

BASE_URL="${1:-${BASE_URL:-http://localhost:4000}}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-10}"
BACKOFF_BASE="${BACKOFF_BASE:-2}"
BACKOFF_CAP=30
CONNECT_TIMEOUT="${CONNECT_TIMEOUT:-3}"
REQUEST_TIMEOUT="${REQUEST_TIMEOUT:-10}"
REQUIRE_PUBLIC_ENDPOINTS="${REQUIRE_PUBLIC_ENDPOINTS:-false}"
PUBLIC_API_URL="${PUBLIC_API_URL:-}"
PUBLIC_APP_URL="${PUBLIC_APP_URL:-}"

case "$REQUIRE_PUBLIC_ENDPOINTS" in
  true|false) ;;
  *)
    log "FAIL  REQUIRE_PUBLIC_ENDPOINTS must be true or false"
    exit 1
    ;;
esac

if [ "$REQUIRE_PUBLIC_ENDPOINTS" = "true" ] \
  && { [ -z "$PUBLIC_API_URL" ] || [ -z "$PUBLIC_APP_URL" ]; }; then
  log "FAIL  PUBLIC_API_URL and PUBLIC_APP_URL are required for the public release gate"
  exit 1
fi

if [ -n "$PUBLIC_API_URL" ] || [ -n "$PUBLIC_APP_URL" ]; then
  if [ -z "$PUBLIC_API_URL" ] || [ -z "$PUBLIC_APP_URL" ]; then
    log "FAIL  PUBLIC_API_URL and PUBLIC_APP_URL must be configured together"
    exit 1
  fi
  case "$PUBLIC_API_URL" in
    https://*) ;;
    *)
      log "FAIL  PUBLIC_API_URL must use https://"
      exit 1
      ;;
  esac
  case "$PUBLIC_APP_URL" in
    https://*) ;;
    *)
      log "FAIL  PUBLIC_APP_URL must use https://"
      exit 1
      ;;
  esac
  PUBLIC_API_URL="${PUBLIC_API_URL%/}"
  PUBLIC_APP_URL="${PUBLIC_APP_URL%/}"
fi

# jq is nice-to-have; fall back to grep on the raw JSON when it's missing.
HAVE_JQ=0
if command -v jq >/dev/null 2>&1; then HAVE_JQ=1; fi

# http_status URL  → prints the HTTP status code, body saved to $BODY_FILE.
BODY_FILE="$(mktemp)"
HEADER_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE" "$HEADER_FILE"' EXIT

http_status() {
  local url="$1"
  curl -sS \
    -D "$HEADER_FILE" \
    -o "$BODY_FILE" \
    -w '%{http_code}' \
    --connect-timeout "$CONNECT_TIMEOUT" \
    --max-time "$REQUEST_TIMEOUT" \
    "$url" 2>/dev/null || true
}

content_type_is() {
  local expected="$1"
  grep -Eiq "^content-type:[[:space:]]*${expected}([[:space:]]*;|[[:space:]]*$)" "$HEADER_FILE"
}

check_public_html() {
  local path="$1" marker="$2" code

  code="$(http_status "${PUBLIC_API_URL}${path}")"
  if [ "$code" != "200" ]; then
    log "FAIL  GET ${PUBLIC_API_URL}${path} → http ${code} (want 200)"
    return 1
  fi
  if ! content_type_is 'text/html'; then
    log "FAIL  GET ${PUBLIC_API_URL}${path} → content-type is not text/html"
    return 1
  fi
  if ! grep -Fq "$marker" "$BODY_FILE"; then
    log "FAIL  GET ${PUBLIC_API_URL}${path} → expected page marker is absent"
    return 1
  fi
  log "PASS  public ${path} → 200 over verified HTTPS"
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

run_public_checks() {
  local code fingerprint app_id

  [ -n "$PUBLIC_API_URL" ] || return 0

  check_public_html '/support' 'ChatHouse Support' || return 1
  check_public_html '/privacy' 'ChatHouse Privacy Policy' || return 1
  check_public_html '/terms' 'ChatHouse Terms of Use' || return 1
  check_public_html '/account-deletion' 'Delete a ChatHouse account' || return 1

  code="$(http_status "${PUBLIC_APP_URL}/.well-known/assetlinks.json")"
  if [ "$code" != "200" ]; then
    log "FAIL  GET ${PUBLIC_APP_URL}/.well-known/assetlinks.json → http ${code} (want 200)"
    return 1
  fi
  if ! content_type_is 'application/json'; then
    log "FAIL  assetlinks.json → content-type is not application/json"
    return 1
  fi
  if [ "$HAVE_JQ" -eq 1 ]; then
    fingerprint="$(
      jq -er '
        first(
          .[]
          | select(.relation | index("delegate_permission/common.handle_all_urls"))
          | select(
              .target.namespace == "android_app"
              and .target.package_name == "com.chathouse.app"
            )
          | .target.sha256_cert_fingerprints[0]
        )
      ' "$BODY_FILE" 2>/dev/null
    )" || {
      log "FAIL  assetlinks.json → production Android association is missing"
      return 1
    }
    if [[ ! "$fingerprint" =~ ^([A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$ ]] \
      || [ "$fingerprint" = '00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00' ]; then
      log "FAIL  assetlinks.json → signing fingerprint is invalid or a test sentinel"
      return 1
    fi
  else
    if ! grep -Eq '"package_name"[[:space:]]*:[[:space:]]*"com\.chathouse\.app"' "$BODY_FILE" \
      || ! grep -Fq 'delegate_permission/common.handle_all_urls' "$BODY_FILE" \
      || ! grep -Eq '"([A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}"' "$BODY_FILE" \
      || grep -Fq '00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00' "$BODY_FILE"; then
      log "FAIL  assetlinks.json → production Android association is missing or a test sentinel"
      return 1
    fi
  fi
  log "PASS  public assetlinks.json → production Android association"

  code="$(http_status "${PUBLIC_APP_URL}/.well-known/apple-app-site-association")"
  if [ "$code" != "200" ]; then
    log "FAIL  GET ${PUBLIC_APP_URL}/.well-known/apple-app-site-association → http ${code} (want 200)"
    return 1
  fi
  if ! content_type_is 'application/json'; then
    log "FAIL  apple-app-site-association → content-type is not application/json"
    return 1
  fi
  if [ "$HAVE_JQ" -eq 1 ]; then
    app_id="$(
      jq -er '
        first(
          .applinks.details[]
          | select(
              (.appID | endswith(".com.chathouse.app"))
              and (.paths | index("*"))
            )
          | .appID
        )
      ' "$BODY_FILE" 2>/dev/null
    )" || {
      log "FAIL  apple-app-site-association → production iOS association is missing"
      return 1
    }
    if [[ ! "$app_id" =~ ^[A-Z0-9]{10}\.com\.chathouse\.app$ ]] \
      || [[ "$app_id" == TESTTEAMID.* ]]; then
      log "FAIL  apple-app-site-association → Apple appID is invalid or a test sentinel"
      return 1
    fi
  else
    if ! grep -Eq '"appID"[[:space:]]*:[[:space:]]*"[A-Z0-9]{10}\.com\.chathouse\.app"' "$BODY_FILE" \
      || ! grep -Eq '"paths"[[:space:]]*:[[:space:]]*\[[[:space:]]*"\*"' "$BODY_FILE" \
      || grep -Fq '"TESTTEAMID.com.chathouse.app"' "$BODY_FILE"; then
      log "FAIL  apple-app-site-association → production iOS association is missing or a test sentinel"
      return 1
    fi
  fi
  log "PASS  public apple-app-site-association → production iOS association"

  return 0
}

log "Internal target: ${BASE_URL} (max_attempts=${MAX_ATTEMPTS}, jq=${HAVE_JQ})"
if [ -n "$PUBLIC_API_URL" ]; then
  log "Public targets: api=${PUBLIC_API_URL}, app=${PUBLIC_APP_URL}"
fi

backoff="$BACKOFF_BASE"
for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  log "Attempt ${attempt}/${MAX_ATTEMPTS}"
  if run_checks && run_public_checks; then
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
