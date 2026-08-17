#!/usr/bin/env bash
#
# test_backup.sh — CI-friendly smoke test for the backup pipeline.
#
# Runs the production backup script against a disposable CI database, then
# validates the generated gzip artifact. This intentionally calls pg_backup.sh
# instead of duplicating its pipeline, so the smoke test cannot drift away from
# the script deployed to operators.
#
# Uses the same env vars as pg_backup.sh.
#
set -euo pipefail

log() {
  printf '%s [test_backup] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
BACKUP_SCRIPT="${SCRIPT_DIR}/pg_backup.sh"

POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-chathouse}"
POSTGRES_USER="${POSTGRES_USER:-chathouse}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-chathouse}"

export PGPASSWORD="${POSTGRES_PASSWORD}"

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/chathouse_test_backup_XXXXXX")"
TEST_BACKUP_DIR="${TEST_ROOT}/backups"
mkdir -p "$TEST_BACKUP_DIR"

cleanup() {
  case "$TEST_ROOT" in
    "${TMPDIR:-/tmp}"/chathouse_test_backup_*) rm -rf -- "$TEST_ROOT" ;;
    *) log "Refusing to remove unexpected test path: ${TEST_ROOT}" ;;
  esac
}
trap cleanup EXIT

log "Running pg_backup.sh for '${POSTGRES_DB}' on ${POSTGRES_HOST}:${POSTGRES_PORT}"
POSTGRES_HOST="$POSTGRES_HOST" \
POSTGRES_PORT="$POSTGRES_PORT" \
POSTGRES_DB="$POSTGRES_DB" \
POSTGRES_USER="$POSTGRES_USER" \
POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
BACKUP_DIR="$TEST_BACKUP_DIR" \
BACKUP_RETENTION_DAYS=7 \
S3_BACKUP_BUCKET='' \
  bash "$BACKUP_SCRIPT"

mapfile -t BACKUP_FILES < <(
  find "$TEST_BACKUP_DIR" -maxdepth 1 -type f -name 'backup_*.sql.gz' -print
)
if [ "${#BACKUP_FILES[@]}" -ne 1 ]; then
  log "FAIL: expected exactly one backup artifact, found ${#BACKUP_FILES[@]}"
  exit 1
fi
BACKUP_FILE="${BACKUP_FILES[0]}"

# Assert: file exists.
if [ ! -f "${BACKUP_FILE}" ]; then
  log "FAIL: backup file does not exist: ${BACKUP_FILE}"
  exit 1
fi

# Assert: size > 0.
if [ ! -s "${BACKUP_FILE}" ]; then
  log "FAIL: backup file is empty: ${BACKUP_FILE}"
  exit 1
fi

FILE_SIZE_BYTES="$(wc -c < "${BACKUP_FILE}" | tr -d '[:space:]')"
log "PASS: backup file exists and is non-empty (${FILE_SIZE_BYTES} bytes)."

# Ensure the generated gzip stream is valid.
if gzip -t "${BACKUP_FILE}" 2>/dev/null; then
  log "PASS: gzip integrity check ok."
else
  log "FAIL: gzip integrity check failed."
  exit 1
fi

log "All backup smoke tests passed."
exit 0
