#!/bin/sh
# Exit 0 while any known write-blocking migration still needs a database
# maintenance window, 3 when all are complete, and any other non-zero status on
# an operational error.
(
set -eu

mode="${1:-check}"
case "$mode" in
  check|--wait-for-owner-idle) ;;
  *)
    printf '%s\n' "unsupported migration-maintenance mode: ${mode}" >&2
    exit 1
    ;;
esac

log() {
  printf '%s [migration-maintenance-check] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

for required_variable in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB; do
  eval "required_value=\${${required_variable}:-}"
  [ -n "$required_value" ] || {
    log "ERROR: ${required_variable} is required"
    exit 1
  }
done

export PGPASSWORD="$POSTGRES_PASSWORD"
set -- \
  --no-psqlrc \
  --quiet \
  --tuples-only \
  --no-align \
  --set=ON_ERROR_STOP=1 \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB"
if [ -n "${POSTGRES_HOST:-}" ]; then
  set -- "$@" --host="$POSTGRES_HOST" --port="${POSTGRES_PORT:-5432}"
fi

if [ "$mode" = --wait-for-owner-idle ]; then
  # Killing the one-off migration container closes its database connections,
  # but PostgreSQL may still be rolling back the transaction. Do not restart
  # API writers until every non-idle session owned by the migration role has
  # disappeared. The bounded wait fails closed if rollback stalls.
  attempt=1
  max_attempts=60
  while :; do
    active_owner_sessions=$(psql "$@" <<'SQL'
SELECT COUNT(*)
FROM pg_catalog.pg_stat_activity
WHERE datname = current_database()
  AND usename = current_user
  AND pid <> pg_backend_pid()
  AND state <> 'idle';
SQL
    )
    case "$active_owner_sessions" in
      ''|*[!0-9]*)
        log "ERROR: unexpected active-session count"
        exit 1
        ;;
      0)
        unset PGPASSWORD
        log "Migration owner has no active sessions; database rollback is quiescent"
        exit 0
        ;;
    esac
    if [ "$attempt" -ge "$max_attempts" ]; then
      log "ERROR: migration owner remained active after $((max_attempts * 2)) seconds"
      exit 1
    fi
    sleep 2
    attempt=$((attempt + 1))
  done
fi

ledger_exists=$(psql "$@" <<'SQL'
SELECT CASE WHEN to_regclass('public."_prisma_migrations"') IS NULL THEN 'no' ELSE 'yes' END;
SQL
)

if [ "$ledger_exists" = yes ]; then
  migration_complete=$(psql "$@" <<'SQL'
SELECT CASE WHEN
  COUNT(DISTINCT migration_name) FILTER (
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
  ) = 4
  AND COUNT(*) FILTER (
    WHERE finished_at IS NULL AND rolled_back_at IS NULL
  ) = 0
THEN 'yes' ELSE 'no' END
FROM public."_prisma_migrations"
WHERE migration_name IN (
  '20260810190000_search_trigram_indexes',
  '20260810190000_stable_notification_follow_cursors',
  '20260810214000_media_idempotency_cleanup',
  '20260810220000_participant_admission_lease'
);
SQL
  )
elif [ "$ledger_exists" = no ]; then
  migration_complete=no
else
  log "ERROR: unexpected migration-ledger result"
  exit 1
fi
unset PGPASSWORD

case "$migration_complete" in
  yes)
    log "All blocking migrations are already complete"
    exit 3
    ;;
  no)
    log "At least one blocking migration requires a maintenance window"
    exit 0
    ;;
  *)
    log "ERROR: unexpected migration-state result"
    exit 1
    ;;
esac
)
