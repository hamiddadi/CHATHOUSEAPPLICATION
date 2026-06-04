#!/usr/bin/env bash
#
# docker-entrypoint.sh — generates a crontab from BACKUP_CRON_SCHEDULE at
# container start (so the schedule is configurable via env), then runs crond in
# the foreground.
#
set -euo pipefail

log() {
  printf '%s [backup-entrypoint] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

BACKUP_CRON_SCHEDULE="${BACKUP_CRON_SCHEDULE:-0 2 * * *}"
CRON_LOG="/var/log/pg_backup.log"
CRONTAB_FILE="/etc/crontabs/root"

# Cron runs with a minimal environment; persist the backup-relevant variables
# into /etc/environment so the scheduled job inherits them via the login shell.
log "Capturing backup environment for cron jobs"
{
  for var in POSTGRES_HOST POSTGRES_PORT POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD \
             BACKUP_DIR BACKUP_RETENTION_DAYS \
             S3_BACKUP_BUCKET S3_BACKUP_PREFIX \
             AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION AWS_REGION; do
    if [ -n "${!var:-}" ]; then
      printf 'export %s=%q\n' "${var}" "${!var}"
    fi
  done
} > /etc/backup.env
chmod 600 /etc/backup.env

touch "${CRON_LOG}"

# Write the crontab. The job sources the captured env then runs the backup,
# appending stdout+stderr to the cron log (also mirrored to the container log).
log "Installing crontab with schedule: ${BACKUP_CRON_SCHEDULE}"
mkdir -p "$(dirname "${CRONTAB_FILE}")"
cat > "${CRONTAB_FILE}" <<EOF
${BACKUP_CRON_SCHEDULE} . /etc/backup.env; /usr/local/bin/pg_backup.sh >> ${CRON_LOG} 2>&1
EOF
chmod 600 "${CRONTAB_FILE}"

# Optionally run one backup immediately on startup (handy for verification).
if [ "${BACKUP_RUN_ON_START:-false}" = "true" ]; then
  log "BACKUP_RUN_ON_START=true — running an initial backup"
  ( . /etc/backup.env; /usr/local/bin/pg_backup.sh ) >> "${CRON_LOG}" 2>&1 || \
    log "WARNING: initial backup failed (continuing to start crond)"
fi

# Stream the cron log to the container's stdout so `docker logs` shows backups.
log "Tailing ${CRON_LOG} to container stdout"
tail -F "${CRON_LOG}" &

log "Starting crond in foreground"
# -f foreground, -l 8 log level, -L log to stderr.
exec crond -f -l 8 -L /dev/stderr
