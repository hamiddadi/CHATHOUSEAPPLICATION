#!/usr/bin/env bash
#
# pg_backup.sh — Automated PostgreSQL backup for ChatHouse.
#
# Produces a plain-SQL, gzip-compressed dump named backup_YYYYMMDD_HHMMSS.sql.gz.
# Optionally uploads it to S3 (when S3_BACKUP_BUCKET is set) and prunes local
# backups older than BACKUP_RETENTION_DAYS days.
#
# This script is cron-compatible: it uses absolute paths, never prompts, and
# exits non-zero on failure so cron/monitoring can detect a broken backup.
#
# Environment variables (see .env.backup.example):
#   POSTGRES_HOST           DB host          (default: postgres)
#   POSTGRES_PORT           DB port          (default: 5432)
#   POSTGRES_DB             DB name          (default: chathouse)
#   POSTGRES_USER           DB user          (default: chathouse)
#   POSTGRES_PASSWORD       DB password      (default: chathouse)  -> exported as PGPASSWORD
#   BACKUP_DIR              local dir        (default: /backups)
#   BACKUP_RETENTION_DAYS   local retention  (default: 7)
#   S3_BACKUP_BUCKET        S3 bucket name   (default: "" => local only)
#   S3_BACKUP_PREFIX        S3 key prefix    (default: chathouse)
#   AWS_*                   standard aws-cli credentials/region (read by aws)
#
set -euo pipefail

# ── timestamped logger ───────────────────────────────────────────────────────
log() {
  printf '%s [pg_backup] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

# ── configuration (env with safe defaults) ───────────────────────────────────
POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-chathouse}"
POSTGRES_USER="${POSTGRES_USER:-chathouse}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-chathouse}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
S3_BACKUP_BUCKET="${S3_BACKUP_BUCKET:-}"
S3_BACKUP_PREFIX="${S3_BACKUP_PREFIX:-chathouse}"

# pg_dump / aws read the password from the environment.
export PGPASSWORD="${POSTGRES_PASSWORD}"

# ── derive output path ───────────────────────────────────────────────────────
TIMESTAMP="$(date -u '+%Y%m%d_%H%M%S')"
BACKUP_FILE="backup_${TIMESTAMP}.sql.gz"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILE}"

mkdir -p "${BACKUP_DIR}"

log "Starting backup of database '${POSTGRES_DB}' on ${POSTGRES_HOST}:${POSTGRES_PORT}"
log "Target file: ${BACKUP_PATH}"

# ── dump: plain SQL piped through gzip ────────────────────────────────────────
# We dump in plain-SQL format (default) and gzip the stream. The matching
# restore is `gunzip -c FILE | psql ...` (NOT pg_restore — pg_restore only
# understands custom/directory/tar archive formats produced with -Fc/-Fd/-Ft).
#
# Because the pipeline's overall exit status reflects the LAST command (gzip),
# a pg_dump failure could otherwise be masked by a successful gzip. We inspect
# PIPESTATUS to detect a pg_dump failure explicitly (fail-safe).
set +e
pg_dump \
  --host="${POSTGRES_HOST}" \
  --port="${POSTGRES_PORT}" \
  --username="${POSTGRES_USER}" \
  --dbname="${POSTGRES_DB}" \
  --no-owner \
  --no-privileges \
  | gzip -9 > "${BACKUP_PATH}"
PIPE_STATUS=("${PIPESTATUS[@]}")
set -e

DUMP_RC="${PIPE_STATUS[0]}"
GZIP_RC="${PIPE_STATUS[1]:-0}"

if [ "${DUMP_RC}" -ne 0 ]; then
  log "ERROR: pg_dump failed with exit code ${DUMP_RC}"
  rm -f "${BACKUP_PATH}"
  exit 1
fi
if [ "${GZIP_RC}" -ne 0 ]; then
  log "ERROR: gzip failed with exit code ${GZIP_RC}"
  rm -f "${BACKUP_PATH}"
  exit 1
fi

# Sanity check: the gzipped dump must be non-empty.
if [ ! -s "${BACKUP_PATH}" ]; then
  log "ERROR: backup file is empty: ${BACKUP_PATH}"
  rm -f "${BACKUP_PATH}"
  exit 1
fi

BACKUP_SIZE="$(du -h "${BACKUP_PATH}" | cut -f1)"
log "Backup completed locally: ${BACKUP_PATH} (${BACKUP_SIZE})"

# ── optional S3 upload ───────────────────────────────────────────────────────
if [ -n "${S3_BACKUP_BUCKET}" ]; then
  S3_DEST="s3://${S3_BACKUP_BUCKET}/${S3_BACKUP_PREFIX}/${BACKUP_FILE}"
  log "Uploading to ${S3_DEST}"
  if aws s3 cp "${BACKUP_PATH}" "${S3_DEST}"; then
    log "Upload succeeded: ${S3_DEST}"
  else
    log "ERROR: S3 upload failed for ${S3_DEST}"
    exit 1
  fi
else
  log "S3_BACKUP_BUCKET not set — keeping backup locally only."
fi

# ── prune old LOCAL backups ──────────────────────────────────────────────────
# Only local copies are pruned here; configure an S3 lifecycle policy on the
# bucket to expire remote objects.
log "Pruning local backups older than ${BACKUP_RETENTION_DAYS} day(s) in ${BACKUP_DIR}"
find "${BACKUP_DIR}" \
  -maxdepth 1 \
  -type f \
  -name 'backup_*.sql.gz' \
  -mtime "+${BACKUP_RETENTION_DAYS}" \
  -print \
  -delete || log "WARNING: pruning encountered an error (continuing)"

log "Backup run finished successfully."
exit 0
