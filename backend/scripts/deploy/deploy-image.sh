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
DB_BOOTSTRAP_SERVICE="${DB_BOOTSTRAP_SERVICE:-db-role-bootstrap}"
DB_MIGRATION_SERVICE="${DB_MIGRATION_SERVICE:-migrate}"
DB_GRANTS_SERVICE="${DB_GRANTS_SERVICE:-db-role-grants}"
DB_MAINTENANCE_CHECK_SERVICE="${DB_MAINTENANCE_CHECK_SERVICE:-db-maintenance-check}"
LIVEKIT_REVOCATION_WORKER_SERVICE="${LIVEKIT_REVOCATION_WORKER_SERVICE:-livekit-revocation-worker}"
LIVEKIT_REVOCATION_WORKER_CONTAINER_NAME="${LIVEKIT_REVOCATION_WORKER_CONTAINER_NAME:-chathouse-livekit-revocation-worker}"
ALLOW_ONE_WAY_LIVEKIT_REVOCATION_UPGRADE="${ALLOW_ONE_WAY_LIVEKIT_REVOCATION_UPGRADE:-false}"
ALLOW_ONE_WAY_DATABASE_ROLE_UPGRADE="${ALLOW_ONE_WAY_DATABASE_ROLE_UPGRADE:-false}"
RUN_DATABASE_MIGRATIONS="${RUN_DATABASE_MIGRATIONS:-true}"
CADDY_SERVICE="${CADDY_SERVICE:-}"
CADDYFILE="${CADDYFILE:-${DEPLOY_DIR}/Caddyfile}"
ROLLBACK_CADDYFILE="${ROLLBACK_CADDYFILE:-}"
BASE_URL="${BASE_URL:-http://localhost:4000}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-10}"
DATABASE_MAINTENANCE_ACTIVE=0
LIVEKIT_WORKER_GUARD_ACTIVE=0
PREV_IMAGE_LIVEKIT_COMPATIBLE=0
PREV_IMAGE_DATABASE_ROLE_COMPATIBLE=0
REQUIRED_DATABASE_ROLE_CONTRACT=v1
REQUIRED_LIVEKIT_REVOCATION_CONTRACT=v1
MIGRATION_COMMAND_TIMEOUT=35m
MIGRATION_TERMINATION_GRACE=2m
MIGRATION_CONTAINER_NAME="chathouse-prisma-migrate-$$"
LIVEKIT_WORKER_HEALTH_ATTEMPTS=15

case "$RUN_DATABASE_MIGRATIONS" in
  true|false) ;;
  *) die "RUN_DATABASE_MIGRATIONS must be true or false" ;;
esac
case "$ALLOW_ONE_WAY_LIVEKIT_REVOCATION_UPGRADE" in
  true|false) ;;
  *) die "ALLOW_ONE_WAY_LIVEKIT_REVOCATION_UPGRADE must be true or false" ;;
esac
case "$ALLOW_ONE_WAY_DATABASE_ROLE_UPGRADE" in
  true|false) ;;
  *) die "ALLOW_ONE_WAY_DATABASE_ROLE_UPGRADE must be true or false" ;;
esac

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
HEALTH_CHECK="${SCRIPT_DIR}/health-check.sh"
LIVEKIT_DEPLOY_GUARD="${SCRIPT_DIR}/livekit-deploy-guard.sh"

command -v docker >/dev/null 2>&1 || die "docker not found on PATH"
command -v timeout >/dev/null 2>&1 || die "timeout not found on PATH"
[ -d "$DEPLOY_DIR" ] || die "DEPLOY_DIR '${DEPLOY_DIR}' does not exist"
[ -f "$ENV_FILE" ] || die "production env file '${ENV_FILE}' does not exist"
[ -f "$COMPOSE_FILE" ] || die "compose file '${COMPOSE_FILE}' does not exist"
[ -x "$HEALTH_CHECK" ] || die "health check '${HEALTH_CHECK}' is not executable"
[ -r "$LIVEKIT_DEPLOY_GUARD" ] || die "LiveKit deploy guard '${LIVEKIT_DEPLOY_GUARD}' is not readable"
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

image_livekit_revocation_contract() {
  docker image inspect \
    --format '{{ with index .Config.Labels "org.chathouse.livekit-revocation-contract" }}{{ . }}{{ end }}' \
    "$1" 2>/dev/null
}

image_database_role_contract() {
  docker image inspect \
    --format '{{ with index .Config.Labels "org.chathouse.database-role-contract" }}{{ . }}{{ end }}' \
    "$1" 2>/dev/null
}

livekit_worker_container_id() {
  local file="$1"
  local id
  id="$(compose_for "$file" ps -q "$LIVEKIT_REVOCATION_WORKER_SERVICE" 2>/dev/null || true)"
  if [ -z "$id" ]; then
    id="$(docker inspect --format '{{.Id}}' "$LIVEKIT_REVOCATION_WORKER_CONTAINER_NAME" 2>/dev/null || true)"
  fi
  [ -n "$id" ] || return 1
  printf '%s\n' "$id"
}

livekit_worker_container_image_id() {
  local file="$1"
  local id
  id="$(livekit_worker_container_id "$file")" || return 1
  docker inspect --format '{{.Image}}' "$id"
}

livekit_worker_is_healthy() {
  local file="$1"
  local expected_image="${2:-}"
  local id actual_image_id expected_image_id state health contract

  id="$(livekit_worker_container_id "$file")" || return 1
  state="$(docker inspect --format '{{.State.Status}}' "$id" 2>/dev/null)" || return 1
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null)" \
    || return 1
  [ "$state" = running ] && [ "$health" = healthy ] || return 1

  actual_image_id="$(docker inspect --format '{{.Image}}' "$id" 2>/dev/null)" || return 1
  contract="$(image_livekit_revocation_contract "$actual_image_id")" || return 1
  [ "$contract" = "$REQUIRED_LIVEKIT_REVOCATION_CONTRACT" ] || return 1

  if [ -n "$expected_image" ]; then
    expected_image_id="$(docker image inspect --format '{{.Id}}' "$expected_image" 2>/dev/null)" \
      || return 1
    [ "$actual_image_id" = "$expected_image_id" ] || return 1
  fi
}

wait_for_livekit_worker_health() {
  local file="$1"
  local image="$2"
  local attempt=1

  while [ "$attempt" -le "$LIVEKIT_WORKER_HEALTH_ATTEMPTS" ]; do
    if livekit_worker_is_healthy "$file" "$image"; then
      log "LiveKit security worker is healthy on the requested image"
      return 0
    fi
    sleep 2
    attempt=$((attempt + 1))
  done
  log "CRITICAL: LiveKit security worker did not become healthy within $((LIVEKIT_WORKER_HEALTH_ATTEMPTS * 2)) seconds"
  return 1
}

activate_livekit_worker() {
  local file="$1"
  local image="$2"

  export CHATHOUSE_API_IMAGE="$image"
  compose_for "$file" config --quiet || return 1
  log "Preflighting the independent LiveKit security worker"
  compose_for "$file" run \
    --rm \
    --no-deps \
    --entrypoint node \
    "$LIVEKIT_REVOCATION_WORKER_SERVICE" \
    dist/workers/livekitSecurity.worker.js \
    --check || return 1
  log "Activating the independent LiveKit security worker before API exposure"
  compose_for "$file" up -d --no-deps "$LIVEKIT_REVOCATION_WORKER_SERVICE" || return 1
  wait_for_livekit_worker_health "$file" "$image"
}

activate_livekit_worker_with_contract() {
  local file="$1"
  local image="$2"
  local contract

  contract="$(image_livekit_revocation_contract "$image")" || {
    log "ERROR: unable to inspect LiveKit revocation contract on worker image '${image}'"
    return 1
  }
  if [ "$contract" != "$REQUIRED_LIVEKIT_REVOCATION_CONTRACT" ]; then
    log "CRITICAL: worker image '${image}' lacks LiveKit revocation contract '${REQUIRED_LIVEKIT_REVOCATION_CONTRACT}'"
    return 1
  fi
  activate_livekit_worker "$file" "$image"
}

# shellcheck source=./livekit-deploy-guard.sh
source "$LIVEKIT_DEPLOY_GUARD"

stop_migration_container_and_wait() {
  if docker inspect "$MIGRATION_CONTAINER_NAME" >/dev/null 2>&1; then
    log "Stopping the migration container before API recovery"
    docker rm -f "$MIGRATION_CONTAINER_NAME" >/dev/null 2>&1 || {
      log "CRITICAL: unable to remove migration container '${MIGRATION_CONTAINER_NAME}'"
      return 1
    }
  fi
  if docker inspect "$MIGRATION_CONTAINER_NAME" >/dev/null 2>&1; then
    log "CRITICAL: migration container '${MIGRATION_CONTAINER_NAME}' is still present"
    return 1
  fi

  log "Waiting for the migration owner's database transaction to become quiescent"
  compose_for "$COMPOSE_FILE" run --rm --no-deps "$DB_MAINTENANCE_CHECK_SERVICE" \
    --wait-for-owner-idle
}

run_migrations_bounded() {
  local file="$1"
  local migration_status=0

  # Give the entire Prisma command a bound below the remote SSH action's bound.
  # The global fixed container name lets both this normal error path and signal
  # traps deterministically stop a one-off that survives an interrupted Docker
  # CLI before any API writer is restarted.
  stop_migration_container_and_wait || return 1
  timeout \
    --foreground \
    --signal=TERM \
    --kill-after="$MIGRATION_TERMINATION_GRACE" \
    "$MIGRATION_COMMAND_TIMEOUT" \
    docker compose \
      --env-file "$ENV_FILE" \
      --project-directory "$DEPLOY_DIR" \
      -f "$file" \
      run --name "$MIGRATION_CONTAINER_NAME" --rm --no-deps "$DB_MIGRATION_SERVICE" \
    || migration_status=$?

  if [ "$migration_status" -ne 0 ]; then
    if [ "$migration_status" -eq 124 ] || [ "$migration_status" -eq 137 ]; then
      log "Migration command exceeded its ${MIGRATION_COMMAND_TIMEOUT} safety bound"
    fi
    stop_migration_container_and_wait || return 1
    return "$migration_status"
  fi
}

prepare_database() {
  local file="$1"
  local image="$2"

  export CHATHOUSE_API_IMAGE="$image"
  compose_for "$file" config --quiet || return 1

  log "Creating or hardening the restricted PostgreSQL application role"
  compose_for "$file" run --rm --no-deps "$DB_BOOTSTRAP_SERVICE" || return 1

  if [ "$RUN_DATABASE_MIGRATIONS" = "true" ]; then
    local maintenance_status=0
    compose_for "$file" run --rm --no-deps "$DB_MAINTENANCE_CHECK_SERVICE" \
      || maintenance_status=$?
    case "$maintenance_status" in
      0)
        log "Stopping the API for the blocking-migration maintenance window"
        compose_for "$file" stop "$API_SERVICE" || return 1
        DATABASE_MAINTENANCE_ACTIVE=1
        ;;
      3) ;;
      *)
        log "Unable to determine whether database maintenance is required"
        return 1
        ;;
    esac
    log "Applying Prisma migrations with the migration-only database role"
    run_migrations_bounded "$file" || return 1
  else
    log "Skipping forward migrations for rollback activation"
  fi

  log "Reapplying restricted grants after the migration step"
  compose_for "$file" run --rm --no-deps "$DB_GRANTS_SERVICE" || return 1
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

# Resolve one local image ID to a pullable, immutable digest belonging to the
# same application repository as NEW_IMAGE. Config.Image is insufficient: it
# may only contain a mutable tag.
digest_ref_for_image_id() {
  local image_id="$1"
  local refs ref
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

container_digest_ref() {
  local file="$1"
  local image_id
  image_id="$(container_image_id "$file")" || return 1
  digest_ref_for_image_id "$image_id"
}

livekit_worker_digest_ref() {
  local file="$1"
  local image_id
  image_id="$(livekit_worker_container_image_id "$file")" || return 1
  digest_ref_for_image_id "$image_id"
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

recover_interrupted_maintenance() {
  local signal="$1"
  local caddy_recovered=1

  # Avoid recursive traps if the remote runner sends another signal while the
  # recovery commands are executing.
  trap - TERM INT HUP
  log "Received ${signal} during deployment"
  if [ "$DATABASE_MAINTENANCE_ACTIVE" -ne 1 ]; then
    if [ "$LIVEKIT_WORKER_GUARD_ACTIVE" -eq 1 ] \
      && ! restore_previous_livekit_security_worker; then
      log "CRITICAL: interrupted deployment left no healthy LiveKit security worker"
    fi
    exit 1
  fi

  log "Maintenance was active; restoring the previous infrastructure before exit"
  if ! stop_migration_container_and_wait; then
    log "CRITICAL: migration cleanup is unproven; refusing to restart API writers"
    exit 1
  fi
  if ! restore_previous_livekit_security_worker; then
    log "CRITICAL: LiveKit security worker recovery failed; refusing to restart API writers"
    exit 1
  fi
  if [ -n "$CADDY_SERVICE" ]; then
    caddy_recovered=0
    if restore_caddyfile \
      && validate_caddy "$ROLLBACK_COMPOSE_FILE" \
      && activate_caddy "$ROLLBACK_COMPOSE_FILE"; then
      caddy_recovered=1
    fi
  fi

  if [ -n "${PREV_IMAGE:-}" ] \
    && [ "$caddy_recovered" -eq 1 ] \
    && activate_previous_image \
    && verify_internal_health; then
    DATABASE_MAINTENANCE_ACTIVE=0
    log "Interrupted maintenance recovered; previous API is healthy"
  else
    log "CRITICAL: interrupted maintenance could not restore a healthy previous API"
  fi
  exit 1
}

CURRENT_CONTAINER="$(container_id "$ROLLBACK_COMPOSE_FILE" 2>/dev/null || true)"
PREV_IMAGE="$(container_digest_ref "$ROLLBACK_COMPOSE_FILE" 2>/dev/null || true)"
if [ -n "$CURRENT_CONTAINER" ] && [ -z "$PREV_IMAGE" ]; then
  die "the running API image has no pullable digest for '${IMAGE_REPOSITORY}'; refusing an activation without a safe rollback target"
fi
CURRENT_LIVEKIT_WORKER_CONTAINER="$(livekit_worker_container_id "$COMPOSE_FILE" 2>/dev/null || true)"
PREV_LIVEKIT_WORKER_IMAGE="$(livekit_worker_digest_ref "$COMPOSE_FILE" 2>/dev/null || true)"
if [ -n "$CURRENT_LIVEKIT_WORKER_CONTAINER" ] && [ -z "$PREV_LIVEKIT_WORKER_IMAGE" ]; then
  die "the running LiveKit security worker has no pullable digest for '${IMAGE_REPOSITORY}'; refusing to replace it without recovery evidence"
fi
log "Previous image: ${PREV_IMAGE:-<none>}"
log "Previous LiveKit security worker image: ${PREV_LIVEKIT_WORKER_IMAGE:-<none>}"
log "Requested image: ${NEW_IMAGE}"
trap 'recover_interrupted_maintenance TERM' TERM
trap 'recover_interrupted_maintenance INT' INT
trap 'recover_interrupted_maintenance HUP' HUP

# Pulling by digest gives Docker a cryptographically verified content identity.
# The workflow owns restoration of the on-disk Compose definition if this
# pre-activation step fails.
log "Pulling ${NEW_IMAGE}"
docker pull "$NEW_IMAGE" || die "unable to pull immutable image '${NEW_IMAGE}'"

# Images produced before the role split still execute CREATE INDEX during API
# boot. They cannot safely run with the restricted runtime DSN, so fail closed
# before touching the database. The LiveKit contract is mandatory for forward,
# manual rollback and captured previous-image activation alike.
IMAGE_DATABASE_ROLE_CONTRACT="$(image_database_role_contract "$NEW_IMAGE")" \
  || die "unable to inspect the database-role contract label on '${NEW_IMAGE}'"
[ "$IMAGE_DATABASE_ROLE_CONTRACT" = "$REQUIRED_DATABASE_ROLE_CONTRACT" ] \
  || die "image is incompatible with the restricted database-role contract '${REQUIRED_DATABASE_ROLE_CONTRACT}'"
IMAGE_LIVEKIT_REVOCATION_CONTRACT="$(image_livekit_revocation_contract "$NEW_IMAGE")" \
  || die "unable to inspect the LiveKit revocation contract on '${NEW_IMAGE}'"
[ "$IMAGE_LIVEKIT_REVOCATION_CONTRACT" = "$REQUIRED_LIVEKIT_REVOCATION_CONTRACT" ] \
  || die "image is incompatible with the LiveKit revocation contract '${REQUIRED_LIVEKIT_REVOCATION_CONTRACT}'"
LIVEKIT_WORKER_GUARD_ACTIVE=1

# Establish rollback compatibility before bootstrap/grants, maintenance, API
# shutdown or migrations. The first v1 cutover is deliberately one-way and is
# possible only with an explicit, documented operator acknowledgement.
preflight_previous_api_livekit_contract "$CURRENT_CONTAINER" "$PREV_IMAGE" \
  || die "captured previous API image is not a safe LiveKit rollback target"
preflight_previous_api_database_role_contract "$CURRENT_CONTAINER" "$PREV_IMAGE" \
  || die "captured previous API image is not a safe database-role rollback target"

if [ -n "$CADDY_SERVICE" ]; then
  log "Validating candidate Caddy configuration"
  validate_caddy "$COMPOSE_FILE" \
    || die "candidate Caddy configuration is invalid; activation refused"
fi

# Database preparation normally leaves the existing API online. Known
# transactional write-blocking migrations are the exception: the check above opens a
# bounded maintenance window instead of silently blocking live writes.
if ! prepare_database "$COMPOSE_FILE" "$NEW_IMAGE"; then
  if [ "$DATABASE_MAINTENANCE_ACTIVE" -eq 1 ] && [ -n "$PREV_IMAGE" ]; then
    # run_migrations_bounded normally proves this already. Repeat the check on
    # the recovery boundary so even a failed container removal/session-idle
    # probe can never fall through to an API restart with migration writes or
    # rollback still active in PostgreSQL.
    if ! stop_migration_container_and_wait; then
      die "CRITICAL: database preparation failed and migration quiescence is unproven; refusing to restart API writers"
    fi
    if ! restore_previous_livekit_security_worker; then
      die "CRITICAL: database preparation failed and no healthy LiveKit security worker can be guaranteed; refusing to restart API writers"
    fi
    log "Database preparation failed during maintenance; restarting the previous API image"
    if activate_previous_image && verify_internal_health; then
      DATABASE_MAINTENANCE_ACTIVE=0
      die "database preparation failed; previous API image restored"
    fi
    die "CRITICAL: database preparation failed and the previous API could not be restored"
  fi
  if ! restore_previous_livekit_security_worker; then
    die "CRITICAL: database preparation failed and no healthy LiveKit security worker can be guaranteed; current API left running"
  fi
  die "database role bootstrap, migration or grant application failed; API activation refused"
fi

if ! activate_livekit_worker_with_contract "$COMPOSE_FILE" "$NEW_IMAGE"; then
  if ! restore_previous_livekit_security_worker; then
    die "CRITICAL: candidate LiveKit security worker failed and no contract-v1 worker could be recovered; API activation refused"
  fi
  if [ "$DATABASE_MAINTENANCE_ACTIVE" -eq 1 ] && [ -n "$PREV_IMAGE" ]; then
    log "Candidate LiveKit security worker failed during maintenance; restarting the previous API image"
    if activate_previous_image && verify_internal_health; then
      DATABASE_MAINTENANCE_ACTIVE=0
      die "candidate LiveKit security worker failed; previous API restored with a healthy security worker"
    fi
    die "CRITICAL: candidate LiveKit security worker failed and previous API recovery also failed"
  fi
  die "candidate LiveKit security worker failed; API activation refused and the existing API remains authoritative"
fi

deploy_ok=0
candidate_activated=0
if activate_image_with_runtime_contracts "$COMPOSE_FILE" "$NEW_IMAGE"; then
  candidate_activated=1
elif [ "$RUN_DATABASE_MIGRATIONS" = false ]; then
  log "Rollback target API activation failed; restoring the captured worker before exit"
  if ! restore_previous_livekit_security_worker; then
    die "CRITICAL: rollback target API activation failed and the captured worker could not be restored"
  fi
  die "rollback target activation refused; current API worker remains authoritative"
fi
if [ "$candidate_activated" -eq 1 ]; then
  if [ -n "$CADDY_SERVICE" ]; then
    log "Image activated; reloading validated Caddy configuration"
  fi
  if activate_caddy "$COMPOSE_FILE"; then
    log "Candidate infrastructure activated; running health gate"
    if verify_health && livekit_worker_is_healthy "$COMPOSE_FILE" "$NEW_IMAGE"; then
      deploy_ok=1
    fi
  fi
fi

if [ "$deploy_ok" -eq 1 ]; then
  DATABASE_MAINTENANCE_ACTIVE=0
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
if ! restore_previous_livekit_security_worker; then
  die "CRITICAL: no healthy LiveKit security worker is available; refusing previous API activation"
fi

image_reactivated=0
if activate_previous_image; then
  image_reactivated=1
fi

if [ "$image_reactivated" -eq 1 ] \
  && [ "$caddyfile_restored" -eq 1 ] \
  && [ "$caddy_reactivated" -eq 1 ] \
  && livekit_worker_is_healthy "$COMPOSE_FILE"; then
  log "Previous infrastructure reactivated; verifying internal health"
  if verify_internal_health; then
    rollback_ok=1
  fi
fi

if [ "$rollback_ok" -eq 1 ]; then
  DATABASE_MAINTENANCE_ACTIVE=0
  log "Previous image '${PREV_IMAGE}' and Caddy configuration restored and healthy"
  exit 1
fi

die "CRITICAL: failed to restore healthy previous infrastructure for '${PREV_IMAGE}'"
