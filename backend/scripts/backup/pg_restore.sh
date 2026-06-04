#!/usr/bin/env bash
#
# pg_restore.sh — Interactive restore of a ChatHouse PostgreSQL backup.
#
# Lists the 10 most recent backups (from the local BACKUP_DIR, or from S3 when
# S3_BACKUP_BUCKET is set), prompts for a selection and a confirmation, then
# restores the chosen dump.
#
# IMPORTANT: pg_backup.sh produces PLAIN-SQL dumps that are gzip-compressed
# (pg_dump default format, piped through gzip). Plain-SQL dumps are a stream of
# SQL statements and MUST be replayed with `psql`, NOT `pg_restore`. The
# `pg_restore` tool only understands the custom (-Fc), directory (-Fd) and tar
# (-Ft) archive formats. Therefore we restore with:
#     gunzip -c FILE | psql ...
#
# Despite the file name (kept for discoverability alongside pg_backup.sh), this
# script deliberately does not call the pg_restore binary.
#
# Environment variables (see .env.backup.example):
#   POSTGRES_HOST POSTGRES_PORT POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD
#   BACKUP_DIR (default /backups)
#   S3_BACKUP_BUCKET (default "" => local), S3_BACKUP_PREFIX (default chathouse)
#
set -euo pipefail

log() {
  printf '%s [pg_restore] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-chathouse}"
POSTGRES_USER="${POSTGRES_USER:-chathouse}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-chathouse}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
S3_BACKUP_BUCKET="${S3_BACKUP_BUCKET:-}"
S3_BACKUP_PREFIX="${S3_BACKUP_PREFIX:-chathouse}"

export PGPASSWORD="${POSTGRES_PASSWORD}"

# ── gather candidate backups (newest first, max 10) ──────────────────────────
declare -a BACKUPS=()
RESTORE_SOURCE=""

if [ -n "${S3_BACKUP_BUCKET}" ]; then
  RESTORE_SOURCE="s3"
  log "Listing 10 most recent backups in s3://${S3_BACKUP_BUCKET}/${S3_BACKUP_PREFIX}/"
  # aws s3 ls prints: "YYYY-MM-DD HH:MM:SS  <size>  <key>"; sort by date desc.
  while IFS= read -r key; do
    [ -n "${key}" ] && BACKUPS+=("${key}")
  done < <(aws s3 ls "s3://${S3_BACKUP_BUCKET}/${S3_BACKUP_PREFIX}/" \
            | grep -E 'backup_[0-9]{8}_[0-9]{6}\.sql\.gz$' \
            | sort -r \
            | head -n 10 \
            | awk '{print $NF}')
else
  RESTORE_SOURCE="local"
  log "Listing 10 most recent backups in ${BACKUP_DIR}"
  while IFS= read -r path; do
    [ -n "${path}" ] && BACKUPS+=("${path}")
  done < <(find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'backup_*.sql.gz' \
            -printf '%T@ %p\n' 2>/dev/null \
            | sort -rn \
            | head -n 10 \
            | cut -d' ' -f2-)
fi

if [ "${#BACKUPS[@]}" -eq 0 ]; then
  log "ERROR: no backups found (${RESTORE_SOURCE})."
  exit 1
fi

# ── present menu ─────────────────────────────────────────────────────────────
echo
echo "Available backups (${RESTORE_SOURCE}), newest first:"
i=1
for b in "${BACKUPS[@]}"; do
  printf '  %2d) %s\n' "${i}" "${b}"
  i=$((i + 1))
done
echo

# ── prompt for selection ─────────────────────────────────────────────────────
read -r -p "Select a backup to restore [1-${#BACKUPS[@]}]: " SELECTION
if ! [[ "${SELECTION}" =~ ^[0-9]+$ ]] || [ "${SELECTION}" -lt 1 ] || [ "${SELECTION}" -gt "${#BACKUPS[@]}" ]; then
  log "ERROR: invalid selection '${SELECTION}'."
  exit 1
fi
CHOSEN="${BACKUPS[$((SELECTION - 1))]}"

echo
echo "About to restore '${CHOSEN}' into database:"
echo "  host=${POSTGRES_HOST} port=${POSTGRES_PORT} db=${POSTGRES_DB} user=${POSTGRES_USER}"
echo "WARNING: this replays the dump on top of the existing database."
read -r -p "Proceed? [y/N]: " CONFIRM
case "${CONFIRM}" in
  [yY] | [yY][eE][sS]) ;;
  *)
    log "Aborted by user."
    exit 0
    ;;
esac

# ── fetch from S3 if needed ──────────────────────────────────────────────────
LOCAL_FILE=""
TMP_FILE=""
cleanup() {
  [ -n "${TMP_FILE}" ] && [ -f "${TMP_FILE}" ] && rm -f "${TMP_FILE}"
}
trap cleanup EXIT

if [ "${RESTORE_SOURCE}" = "s3" ]; then
  TMP_FILE="$(mktemp /tmp/chathouse_restore_XXXXXX.sql.gz)"
  S3_KEY="s3://${S3_BACKUP_BUCKET}/${S3_BACKUP_PREFIX}/${CHOSEN}"
  log "Downloading ${S3_KEY}"
  aws s3 cp "${S3_KEY}" "${TMP_FILE}"
  LOCAL_FILE="${TMP_FILE}"
else
  LOCAL_FILE="${CHOSEN}"
fi

if [ ! -s "${LOCAL_FILE}" ]; then
  log "ERROR: backup file is missing or empty: ${LOCAL_FILE}"
  exit 1
fi

# ── restore: gunzip the plain-SQL dump straight into psql ────────────────────
log "Restoring ${CHOSEN} ..."
set +e
gunzip -c "${LOCAL_FILE}" \
  | psql \
      --host="${POSTGRES_HOST}" \
      --port="${POSTGRES_PORT}" \
      --username="${POSTGRES_USER}" \
      --dbname="${POSTGRES_DB}" \
      --set ON_ERROR_STOP=on
PIPE_STATUS=("${PIPESTATUS[@]}")
set -e

GUNZIP_RC="${PIPE_STATUS[0]}"
PSQL_RC="${PIPE_STATUS[1]:-0}"

if [ "${GUNZIP_RC}" -ne 0 ]; then
  log "ERROR: gunzip failed with exit code ${GUNZIP_RC}"
  exit 1
fi
if [ "${PSQL_RC}" -ne 0 ]; then
  log "ERROR: psql restore failed with exit code ${PSQL_RC}"
  exit 1
fi

log "Restore completed successfully from ${CHOSEN}."
exit 0
