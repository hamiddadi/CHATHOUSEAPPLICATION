# ─────────────────────────────────────────────────────────────────────────────
# ChatHouse PostgreSQL backup sidecar.
#
# Runs pg_backup.sh on a cron schedule (BACKUP_CRON_SCHEDULE, default 02:00
# daily). Bundles the PostgreSQL 16 client (must match the server major version
# for pg_dump/psql compatibility), the AWS CLI for optional S3 upload, and a
# cron daemon.
#
# Build context is the backend/ directory:
#   docker build -f docker/backup/Dockerfile -t chathouse-backup ./backend
# (or via docker-compose.backup.yml which sets context: . relative to backend/)
# ─────────────────────────────────────────────────────────────────────────────
FROM alpine:3.20

# postgresql16-client => matching pg_dump/psql for a PostgreSQL 16 server.
# aws-cli            => optional S3 upload (S3_BACKUP_BUCKET).
# bash               => the backup/restore scripts require bash (set -o pipefail, arrays).
# tzdata             => correct local time for cron + log timestamps.
# dcron              => lightweight cron daemon (crond).
# coreutils/findutils=> GNU date/find behaviour the scripts rely on (find -printf, mtime).
RUN apk add --no-cache \
      postgresql16-client \
      aws-cli \
      bash \
      tzdata \
      dcron \
      coreutils \
      findutils

# Install the backup scripts onto PATH.
COPY scripts/backup/pg_backup.sh  /usr/local/bin/pg_backup.sh
COPY scripts/backup/pg_restore.sh /usr/local/bin/pg_restore.sh
COPY docker/backup/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x \
      /usr/local/bin/pg_backup.sh \
      /usr/local/bin/pg_restore.sh \
      /usr/local/bin/docker-entrypoint.sh

# Default local backup target; mount a volume here in compose.
VOLUME ["/backups"]
ENV BACKUP_DIR=/backups

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
