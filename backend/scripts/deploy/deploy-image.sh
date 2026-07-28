#!/usr/bin/env bash
#
# Activate one API image digest with the production Compose definition. When
# CADDY_SERVICE is set, validate and reload the candidate Caddy configuration
# before running the public HTTPS gate. Any failure restores both the previous
# image digest and the previous Caddyfile, then verifies internal health.
#
# Usage:
#   ./deploy-image.sh ghcr.io/owner/repo/api@sha256:<64 lowercase hex chars>
#
set -Eeuo pipefail

log() { printf '%s [deploy-image] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

NEW_IMAGE="${1:-}"
[ -n "$NEW_IMAGE" ] || die "missing image ref (arg 1)"

is_digest_ref() {
  [[ "$1" =~ ^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$ ]]
}

is_digest_ref "$NEW_IMAGE" \
  || die "image ref must be an immutable repository digest (repository@sha256:<64 lowercase hex chars>)"
IMAGE_REPOSITORY="${NEW_IMAGE%@sha256:*}"

DEPLOY_DIR="${DEPLOY_DIR:-/opt/chathouse/backend}"
ENV_FILE="${ENV_FILE:-${DEPLOY_DIR}/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-${DEPLOY_DIR}/docker-compose.prod.yml}"
ROLLBACK_COMPOSE_FILE="${ROLLBACK_COMPOSE_FILE:-${COMPOSE_FILE}}"
API_SERVICE="${API_SERVICE:-api}"
CADDY_SERVICE="${CADDY_SERVICE:-}"
CADDYFILE="${CADDYFILE:-${DEPLOY_DIR}/Caddyfile}"
ROLLBACK_CADDYFILE="${ROLLBACK_CADDYFILE:-}"
BASE_URL="${BASE_URL:-http://localhost:4000}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-10}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
HEALTH_CHECK="${SCRIPT_DIR}/health-check.sh"

command -v docker >/dev/null 2>&1 || die "docker not found on PATH"
[ -d "$DEPLOY_DIR" ] || die "DEPLOY_DIR '${DEPLOY_DIR}' does not exist"
[ -f "$ENV_FILE" ] || die "production env file '${ENV_FILE}' does not exist"
[ -f "$COMPOSE_FILE" ] || die "compose file '${COMPOSE_FILE}' does not exist"
[ -x "$HEALTH_CHECK" ] || die "health check '${HEALTH_CHECK}' is not executable"
if [ ! -f "$ROLLBACK_COMPOSE_FILE" ]; then
  log "Previous Compose snapshot is unavailable; rollback will use the current definition"
  ROLLBACK_COMPOSE_FILE="$COMPOSE_FILE"
fi
if [ -n "$CADDY_SERVICE" ]; then
  [ -f "$CADDYFILE" ] || die "candidate Caddyfile '${CADDYFILE}' does not exist"
  [ -n "$ROLLBACK_CADDYFILE" ] \
    || die "ROLLBACK_CADDYFILE is required when CADDY_SERVICE is enabled"
  [ -f "$ROLLBACK_CADDYFILE" ] \
    || die "previous Caddyfile snapshot '${ROLLBACK_CADDYFILE}' does not exist"
  [ "$ROLLBACK_CADDYFILE" != "$CADDYFILE" ] \
    || die "ROLLBACK_CADDYFILE must be a distinct snapshot"
fi

# docker compose must be able to interpolate the required image variable even
# while we are only inspecting the currently running service.
export CHATHOUSE_API_IMAGE="$NEW_IMAGE"

compose_for() {
  local file="$1"
  shift
  docker compose \
    --env-file "$ENV_FILE" \
    --project-directory "$DEPLOY_DIR" \
    -f "$file" \
    "$@"
}

container_id() {
  local file="$1"
  local id
  id="$(compose_for "$file" ps -q "$API_SERVICE" 2>/dev/null || true)"
  if [ -z "$id" ]; then
    id="$(docker inspect --format '{{.Id}}' chathouse-api 2>/dev/null || true)"
  fi
  [ -n "$id" ] || return 1
  printf '%s\n' "$id"
}

container_image_id() {
  local file="$1"
  local id
  id="$(container_id "$file")" || return 1
  docker inspect --format '{{.Image}}' "$id"
}

# Resolve the running container to a pullable, immutable digest belonging to
# the same application repository as NEW_IMAGE. Config.Image is insufficient:
# it may only contain a mutable tag.
container_digest_ref() {
  local file="$1"
  local image_id refs ref
  image_id="$(container_image_id "$file")" || return 1
  refs="$(docker image inspect \
    --format '{{range .RepoDigests}}{{println .}}{{end}}' \
    "$image_id" 2>/dev/null)" || return 1

  while IFS= read -r ref; do
    if is_digest_ref "$ref" && [ "${ref%@sha256:*}" = "$IMAGE_REPOSITORY" ]; then
      printf '%s\n' "$ref"
      return 0
    fi
  done <<< "$refs"
  return 1
}

activate_image() {
  local file="$1"
  local image="$2"
  local expected_id actual_id

  export CHATHOUSE_API_IMAGE="$image"
  expected_id="$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null)" || return 1
  compose_for "$file" config --quiet || return 1
  compose_for "$file" up -d --no-deps "$API_SERVICE" || return 1
  actual_id="$(container_image_id "$file")" || return 1
  if [ "$actual_id" != "$expected_id" ]; then
    log "Image ID mismatch for requested digest '${image}'"
    return 1
  fi
}

validate_caddy() {
  local file="$1"

  [ -n "$CADDY_SERVICE" ] || return 0
  compose_for "$file" config --quiet || return 1
  compose_for "$file" run \
    --rm \
    --no-deps \
    --entrypoint caddy \
    "$CADDY_SERVICE" \
    validate \
    --config /etc/caddy/Caddyfile \
    --adapter caddyfile || return 1
}

activate_caddy() {
  local file="$1"

  [ -n "$CADDY_SERVICE" ] || return 0
  # Caddyfile is switched atomically with rename(2). Recreate the container so
  # its single-file bind mount follows the new inode before asking Caddy to
  # reload; Compose cannot detect a bind-mounted file's content/inode change.
  compose_for "$file" up -d --force-recreate --no-deps "$CADDY_SERVICE" || return 1
  compose_for "$file" exec -T "$CADDY_SERVICE" \
    caddy reload \
    --config /etc/caddy/Caddyfile \
    --adapter caddyfile || return 1
}

restore_caddyfile() {
  local restore_tmp

  [ -n "$CADDY_SERVICE" ] || return 0
  restore_tmp="$(mktemp "${CADDYFILE}.restore.XXXXXX")" || return 1
  if ! install -m 0644 "$ROLLBACK_CADDYFILE" "$restore_tmp"; then
    rm -f "$restore_tmp"
    return 1
  fi
  if ! mv -f "$restore_tmp" "$CADDYFILE"; then
    rm -f "$restore_tmp"
    return 1
  fi
  log "Previous Caddyfile restored atomically"
}

verify_health() {
  BASE_URL="$BASE_URL" MAX_ATTEMPTS="$MAX_ATTEMPTS" bash "$HEALTH_CHECK"
}

verify_internal_health() {
  BASE_URL="$BASE_URL" \
    MAX_ATTEMPTS="$MAX_ATTEMPTS" \
    REQUIRE_PUBLIC_ENDPOINTS=false \
    PUBLIC_API_URL= \
    PUBLIC_APP_URL= \
    bash "$HEALTH_CHECK"
}

CURRENT_CONTAINER="$(container_id "$ROLLBACK_COMPOSE_FILE" 2>/dev/null || true)"
PREV_IMAGE="$(container_digest_ref "$ROLLBACK_COMPOSE_FILE" 2>/dev/null || true)"
if [ -n "$CURRENT_CONTAINER" ] && [ -z "$PREV_IMAGE" ]; then
  die "the running API image has no pullable digest for '${IMAGE_REPOSITORY}'; refusing an activation without a safe rollback target"
fi
log "Previous image: ${PREV_IMAGE:-<none>}"
log "Requested image: ${NEW_IMAGE}"

# Pulling by digest gives Docker a cryptographically verified content identity.
# The workflow owns restoration of the on-disk Compose definition if this
# pre-activation step fails.
log "Pulling ${NEW_IMAGE}"
docker pull "$NEW_IMAGE" || die "unable to pull immutable image '${NEW_IMAGE}'"

if [ -n "$CADDY_SERVICE" ]; then
  log "Validating candidate Caddy configuration"
  validate_caddy "$COMPOSE_FILE" \
    || die "candidate Caddy configuration is invalid; activation refused"
fi

deploy_ok=0
if activate_image "$COMPOSE_FILE" "$NEW_IMAGE"; then
  if [ -n "$CADDY_SERVICE" ]; then
    log "Image activated; reloading validated Caddy configuration"
  fi
  if activate_caddy "$COMPOSE_FILE"; then
    log "Candidate infrastructure activated; running health gate"
    if verify_health; then
      deploy_ok=1
    fi
  fi
fi

if [ "$deploy_ok" -eq 1 ]; then
  log "Deployment succeeded: ${NEW_IMAGE}"
  exit 0
fi

log "Deployment failed after activation started; restoring previous infrastructure"

rollback_ok=0
caddyfile_restored=1
caddy_reactivated=1
if [ -n "$CADDY_SERVICE" ]; then
  caddyfile_restored=0
  caddy_reactivated=0
  if restore_caddyfile && validate_caddy "$ROLLBACK_COMPOSE_FILE"; then
    caddyfile_restored=1
    if activate_caddy "$ROLLBACK_COMPOSE_FILE"; then
      caddy_reactivated=1
    fi
  fi
fi

if [ -z "$PREV_IMAGE" ]; then
  die "no previous image was recorded; automatic image rollback is impossible"
fi
if ! docker image inspect "$PREV_IMAGE" >/dev/null 2>&1; then
  log "Previous digest is absent locally; pulling ${PREV_IMAGE}"
  docker pull "$PREV_IMAGE" || die "unable to retrieve previous immutable image '${PREV_IMAGE}'"
fi

image_reactivated=0
if activate_image "$ROLLBACK_COMPOSE_FILE" "$PREV_IMAGE"; then
  image_reactivated=1
fi

if [ "$image_reactivated" -eq 1 ] \
  && [ "$caddyfile_restored" -eq 1 ] \
  && [ "$caddy_reactivated" -eq 1 ]; then
  log "Previous infrastructure reactivated; verifying internal health"
  if verify_internal_health; then
    rollback_ok=1
  fi
fi

if [ "$rollback_ok" -eq 1 ]; then
  log "Previous image '${PREV_IMAGE}' and Caddy configuration restored and healthy"
  exit 1
fi

die "CRITICAL: failed to restore healthy previous infrastructure for '${PREV_IMAGE}'"
