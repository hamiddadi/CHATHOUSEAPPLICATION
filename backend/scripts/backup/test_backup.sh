#!/usr/bin/env bash
#
# test_backup.sh — CI-friendly smoke test for the backup pipeline.
#
# Runs a real pg_dump against a (throwaway) database, gzips it to a temp file,
# asserts the file exists and is non-empty, then cleans up. Exits 0 on success,
# 1 on failure. Intended to run in CI against a disposable Postgres instance.
#
# Uses the same env vars as pg_backup.sh.
#
set -euo pipefail

log() {
  printf '%s [test_backup] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-chathouse}"
POSTGRES_USER="${POSTGRES_USER:-chathouse}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-chathouse}"

export PGPASSWORD="${POSTGRES_PASSWORD}"

TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/chathouse_test_backup_XXXXXX.sql.gz")"

cleanup() {
  if [ -f "${TMP_FILE}" ]; then
    rm -f "${TMP_FILE}"
    log "Cleaned up temp file ${TMP_FILE}"
  fi
}
trap cleanup EXIT

log "Dumping '${POSTGRES_DB}' on ${POSTGRES_HOST}:${POSTGRES_PORT} to ${TMP_FILE}"

set +e
pg_dump \
  --host="${POSTGRES_HOST}" \
  --port="${POSTGRES_PORT}" \
  --username="${POSTGRES_USER}" \
  --dbname="${POSTGRES_DB}" \
  --no-owner \
  --no-privileges \
  | gzip -9 > "${TMP_FILE}"
PIPE_STATUS=("${PIPESTATUS[@]}")
set -e

DUMP_RC="${PIPE_STATUS[0]}"
GZIP_RC="${PIPE_STATUS[1]:-0}"

if [ "${DUMP_RC}" -ne 0 ]; then
  log "FAIL: pg_dump exited ${DUMP_RC}"
  exit 1
fi
if [ "${GZIP_RC}" -ne 0 ]; then
  log "FAIL: gzip exited ${GZIP_RC}"
  exit 1
fi

# Assert: file exists.
if [ ! -f "${TMP_FILE}" ]; then
  log "FAIL: backup file does not exist: ${TMP_FILE}"
  exit 1
fi

# Assert: size > 0.
if [ ! -s "${TMP_FILE}" ]; then
  log "FAIL: backup file is empty: ${TMP_FILE}"
  exit 1
fi

FILE_SIZE_BYTES="$(wc -c < "${TMP_FILE}" | tr -d '[:space:]')"
log "PASS: backup file exists and is non-empty (${FILE_SIZE_BYTES} bytes)."

# Optional deeper check: ensure the gzip stream is valid.
if gzip -t "${TMP_FILE}" 2>/dev/null; then
  log "PASS: gzip integrity check ok."
else
  log "FAIL: gzip integrity check failed."
  exit 1
fi

log "All backup smoke tests passed."
exit 0
