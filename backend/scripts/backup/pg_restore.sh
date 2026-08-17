#!/usr/bin/env bash
#
# Restore a plain-SQL gzip backup into a clean temporary database first.
#
# RESTORE_MODE=verify (default):
#   restore to a disposable DB, validate schema/migration history, then drop it.
#
# RESTORE_MODE=replace:
#   after the same clean restore and validation, rename the current target
#   aside and promote the restored DB in a controlled maintenance swap. Requires
#   RESTORE_ALLOW_REPLACE=true plus an interactive database-name confirmation.
#   Stop the API before replacement. The old DB is retained, connection-disabled,
#   for explicit operator cleanup after post-restore validation.
#
# Both modes require RESTORE_CANDIDATE_IMAGE to be the immutable digest of the
# API candidate and RESTORE_CANDIDATE_DOCKER_NETWORK to reach PostgreSQL. The
# image must already exist in the Docker daemon. Its Prisma migration chain is
# applied to the temporary restore and a clean final status is mandatory.
set -Eeuo pipefail

log() {
  printf '%s [pg_restore] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

die() {
  log "ERROR: $*"
  exit 1
}

POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-chathouse}"
POSTGRES_ADMIN_DB="${POSTGRES_ADMIN_DB:-postgres}"
POSTGRES_USER="${POSTGRES_USER:-chathouse}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
S3_BACKUP_BUCKET="${S3_BACKUP_BUCKET:-}"
S3_BACKUP_PREFIX="${S3_BACKUP_PREFIX:-chathouse}"
RESTORE_MODE="${RESTORE_MODE:-verify}"
RESTORE_ALLOW_REPLACE="${RESTORE_ALLOW_REPLACE:-false}"
RESTORE_BACKUP="${RESTORE_BACKUP:-}"
RESTORE_CANDIDATE_IMAGE="${RESTORE_CANDIDATE_IMAGE:-}"
RESTORE_CANDIDATE_DOCKER_NETWORK="${RESTORE_CANDIDATE_DOCKER_NETWORK:-backend_default}"

[ -n "$POSTGRES_PASSWORD" ] || die "POSTGRES_PASSWORD is required"
[[ "$POSTGRES_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] \
  || die "POSTGRES_HOST must be a hostname or IPv4 address without a URL scheme"
[[ "$POSTGRES_PORT" =~ ^[0-9]+$ ]] \
  && [ "$POSTGRES_PORT" -ge 1 ] \
  && [ "$POSTGRES_PORT" -le 65535 ] \
  || die "POSTGRES_PORT must be an integer from 1 to 65535"
[[ "$POSTGRES_DB" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] \
  || die "POSTGRES_DB must be a simple PostgreSQL identifier"
[ "${#POSTGRES_DB}" -le 63 ] || die "POSTGRES_DB exceeds PostgreSQL's 63-byte identifier limit"
[[ "$POSTGRES_ADMIN_DB" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] \
  || die "POSTGRES_ADMIN_DB must be a simple PostgreSQL identifier"
[[ "$RESTORE_CANDIDATE_IMAGE" =~ ^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$ ]] \
  || die "RESTORE_CANDIDATE_IMAGE must be an immutable repository@sha256 digest"
[[ "$RESTORE_CANDIDATE_DOCKER_NETWORK" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] \
  || die "RESTORE_CANDIDATE_DOCKER_NETWORK contains invalid characters"
case "$RESTORE_MODE" in
  verify | replace) ;;
  *) die "RESTORE_MODE must be 'verify' or 'replace'" ;;
esac

command -v docker >/dev/null 2>&1 \
  || die "docker CLI is required to validate the candidate migrations"
docker image inspect "$RESTORE_CANDIDATE_IMAGE" >/dev/null 2>&1 \
  || die "candidate digest is not present in the Docker daemon; pull it before the restore drill"
docker network inspect "$RESTORE_CANDIDATE_DOCKER_NETWORK" >/dev/null 2>&1 \
  || die "candidate Docker network '${RESTORE_CANDIDATE_DOCKER_NETWORK}' is unavailable"

export PGPASSWORD="$POSTGRES_PASSWORD"

declare -a BACKUPS=()
RESTORE_SOURCE=""

if [ -n "$S3_BACKUP_BUCKET" ]; then
  RESTORE_SOURCE="s3"
  while IFS= read -r key; do
    [ -n "$key" ] && BACKUPS+=("$key")
  done < <(
    aws s3 ls "s3://${S3_BACKUP_BUCKET}/${S3_BACKUP_PREFIX}/" |
      grep -E 'backup_[0-9]{8}_[0-9]{6}\.sql\.gz$' |
      sort -r |
      head -n 10 |
      awk '{print $NF}'
  )
else
  RESTORE_SOURCE="local"
  while IFS= read -r path; do
    [ -n "$path" ] && BACKUPS+=("$path")
  done < <(
    find "$BACKUP_DIR" -maxdepth 1 -type f -name 'backup_*.sql.gz' \
      -printf '%T@ %p\n' 2>/dev/null |
      sort -rn |
      head -n 10 |
      cut -d' ' -f2-
  )
fi

[ "${#BACKUPS[@]}" -gt 0 ] || die "no backups found (${RESTORE_SOURCE})"

CHOSEN=""
if [ -n "$RESTORE_BACKUP" ]; then
  for candidate in "${BACKUPS[@]}"; do
    if [ "$candidate" = "$RESTORE_BACKUP" ] || [ "$(basename "$candidate")" = "$RESTORE_BACKUP" ]; then
      CHOSEN="$candidate"
      break
    fi
  done
  [ -n "$CHOSEN" ] || die "RESTORE_BACKUP is not one of the 10 most recent valid backups"
else
  echo
  echo "Available backups (${RESTORE_SOURCE}), newest first:"
  for i in "${!BACKUPS[@]}"; do
    printf '  %2d) %s\n' "$((i + 1))" "${BACKUPS[$i]}"
  done
  echo
  read -r -p "Select a backup to restore [1-${#BACKUPS[@]}]: " selection
  [[ "$selection" =~ ^[0-9]+$ ]] \
    && [ "$selection" -ge 1 ] \
    && [ "$selection" -le "${#BACKUPS[@]}" ] \
    || die "invalid backup selection"
  CHOSEN="${BACKUPS[$((selection - 1))]}"
fi

LOCAL_FILE=""
TMP_FILE=""
RESTORE_DB=""

psql_admin() {
  psql \
    --host="$POSTGRES_HOST" \
    --port="$POSTGRES_PORT" \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_ADMIN_DB" \
    --set ON_ERROR_STOP=on \
    "$@"
}

psql_restore() {
  [ -n "$RESTORE_DB" ] || die "temporary restore database is not initialized"
  psql \
    --host="$POSTGRES_HOST" \
    --port="$POSTGRES_PORT" \
    --username="$POSTGRES_USER" \
    --dbname="$RESTORE_DB" \
    --set ON_ERROR_STOP=on \
    "$@"
}

assert_no_failed_prisma_migrations() {
  local stage="$1"
  local failed_count

  if ! failed_count="$(
    psql_restore \
      --tuples-only --no-align \
      --command='SELECT count(*) FROM public."_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL;'
  )"; then
    die "unable to inspect Prisma migration failures (${stage})"
  fi
  [[ "$failed_count" =~ ^[0-9]+$ ]] \
    || die "invalid Prisma failed-migration count '${failed_count}' (${stage})"
  [ "$failed_count" -eq 0 ] \
    || die "restored database contains ${failed_count} unfinished Prisma migration(s) (${stage})"
}

url_encode() {
  local input="$1"
  local output=""
  local char encoded
  local i
  local LC_ALL=C

  for ((i = 0; i < ${#input}; i++)); do
    char="${input:i:1}"
    case "$char" in
      [A-Za-z0-9.~_-]) output+="$char" ;;
      *)
        printf -v encoded '%%%02X' "'${char}"
        output+="$encoded"
        ;;
    esac
  done
  printf '%s' "$output"
}

validate_candidate_migrations() {
  local encoded_user encoded_password encoded_db database_url

  encoded_user="$(url_encode "$POSTGRES_USER")"
  encoded_password="$(url_encode "$POSTGRES_PASSWORD")"
  encoded_db="$(url_encode "$RESTORE_DB")"
  database_url="postgresql://${encoded_user}:${encoded_password}@${POSTGRES_HOST}:${POSTGRES_PORT}/${encoded_db}?schema=public"

  log "Applying and validating candidate migrations on the temporary restore"
  docker run --rm --pull=never \
    --network "$RESTORE_CANDIDATE_DOCKER_NETWORK" \
    --env "DATABASE_URL=${database_url}" \
    --entrypoint /bin/sh \
    "$RESTORE_CANDIDATE_IMAGE" \
    -ceu '
      npx prisma migrate deploy
      npx prisma migrate status
    '
}

drop_restore_db() {
  [ -n "$RESTORE_DB" ] || return 0
  dropdb \
    --host="$POSTGRES_HOST" \
    --port="$POSTGRES_PORT" \
    --username="$POSTGRES_USER" \
    --if-exists \
    "$RESTORE_DB" >/dev/null 2>&1 || true
}

cleanup() {
  drop_restore_db
  if [ -n "$TMP_FILE" ] && [ -f "$TMP_FILE" ]; then
    rm -f "$TMP_FILE"
  fi
  return 0
}
trap cleanup EXIT

if [ "$RESTORE_SOURCE" = "s3" ]; then
  TMP_FILE="$(mktemp /tmp/chathouse_restore_XXXXXX.sql.gz)"
  s3_key="s3://${S3_BACKUP_BUCKET}/${S3_BACKUP_PREFIX}/${CHOSEN}"
  log "Downloading ${s3_key}"
  aws s3 cp "$s3_key" "$TMP_FILE"
  LOCAL_FILE="$TMP_FILE"
else
  LOCAL_FILE="$CHOSEN"
fi

[ -s "$LOCAL_FILE" ] || die "backup file is missing or empty"
gzip -t "$LOCAL_FILE" || die "backup gzip integrity check failed"

printf -v pid_token '%05d' "$(( $$ % 100000 ))"
suffix="$(date -u '+%Y%m%d%H%M%S')_${pid_token}"
RESTORE_DB="${POSTGRES_DB:0:30}_restore_${suffix}"
log "Creating clean temporary database '${RESTORE_DB}'"
createdb \
  --host="$POSTGRES_HOST" \
  --port="$POSTGRES_PORT" \
  --username="$POSTGRES_USER" \
  --owner="$POSTGRES_USER" \
  --template=template0 \
  "$RESTORE_DB"

log "Restoring '${CHOSEN}' into clean temporary database '${RESTORE_DB}'"
set +e
gunzip -c "$LOCAL_FILE" |
  psql \
    --host="$POSTGRES_HOST" \
    --port="$POSTGRES_PORT" \
    --username="$POSTGRES_USER" \
    --dbname="$RESTORE_DB" \
    --set ON_ERROR_STOP=on
pipe_status=("${PIPESTATUS[@]}")
set -e
[ "${pipe_status[0]}" -eq 0 ] || die "gunzip failed with exit code ${pipe_status[0]}"
[ "${pipe_status[1]:-1}" -eq 0 ] || die "psql restore failed with exit code ${pipe_status[1]:-1}"

table_count="$(
  psql_restore \
    --tuples-only --no-align \
    --command="SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public';"
)"
[ "$table_count" -gt 0 ] || die "restored database has no public tables"
migrations_present="$(
  psql_restore \
    --tuples-only --no-align \
    --command="SELECT to_regclass('public._prisma_migrations') IS NOT NULL;"
)"
[ "$migrations_present" = "t" ] || die "restored database has no Prisma migration history"
assert_no_failed_prisma_migrations "before candidate migration validation"
validate_candidate_migrations
assert_no_failed_prisma_migrations "after candidate migration validation"
log "Clean restore validated (${table_count} public tables, Prisma history and candidate migration status)"

if [ "$RESTORE_MODE" = "verify" ]; then
  log "Restore drill passed; dropping temporary database '${RESTORE_DB}'"
  drop_restore_db
  RESTORE_DB=""
  exit 0
fi

[ "$RESTORE_ALLOW_REPLACE" = "true" ] \
  || die "replacement requires RESTORE_ALLOW_REPLACE=true"
echo
echo "The validated restore will replace database '${POSTGRES_DB}'."
echo "Stop the API first. The current DB will be retained with connections disabled."
read -r -p "Type the exact database name to continue: " confirmation
[ "$confirmation" = "$POSTGRES_DB" ] || die "database confirmation did not match"

old_db="${POSTGRES_DB:0:30}_before_${suffix}"
target_exists="$(psql_admin --tuples-only --no-align --command="SELECT 1 FROM pg_database WHERE datname = '${POSTGRES_DB}';")"
if [ "$target_exists" = "1" ]; then
  old_exists="$(psql_admin --tuples-only --no-align --command="SELECT 1 FROM pg_database WHERE datname = '${old_db}';")"
  [ -z "$old_exists" ] || die "preservation database '${old_db}' already exists"
  log "Disabling connections and preserving current database as '${old_db}'"
  psql_admin --command="ALTER DATABASE \"${POSTGRES_DB}\" WITH ALLOW_CONNECTIONS false;"
  psql_admin --command="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${POSTGRES_DB}' AND pid <> pg_backend_pid();"
  psql_admin --command="ALTER DATABASE \"${POSTGRES_DB}\" RENAME TO \"${old_db}\";"
fi

if ! psql_admin --command="ALTER DATABASE \"${RESTORE_DB}\" RENAME TO \"${POSTGRES_DB}\";"; then
  log "Promotion failed; attempting to restore the original database name"
  if [ "$target_exists" = "1" ]; then
    psql_admin --command="ALTER DATABASE \"${old_db}\" RENAME TO \"${POSTGRES_DB}\";" || true
    psql_admin --command="ALTER DATABASE \"${POSTGRES_DB}\" WITH ALLOW_CONNECTIONS true;" || true
  fi
  die "unable to promote restored database"
fi
RESTORE_DB=""
psql_admin --command="ALTER DATABASE \"${POSTGRES_DB}\" WITH ALLOW_CONNECTIONS true;"

if [ "$target_exists" = "1" ]; then
  log "Restore promoted successfully; old DB retained as '${old_db}' with connections disabled"
  log "Drop '${old_db}' only after application validation and a fresh backup"
else
  log "Restore promoted successfully into new database '${POSTGRES_DB}'"
fi
