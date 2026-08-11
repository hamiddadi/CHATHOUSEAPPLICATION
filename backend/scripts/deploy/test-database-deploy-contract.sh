#!/bin/sh
# Static guard for the safety-critical production database activation order.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEPLOY_SCRIPT="${SCRIPT_DIR}/deploy-image.sh"
ROLLBACK_SCRIPT="${SCRIPT_DIR}/rollback.sh"
MAINTENANCE_SCRIPT="${SCRIPT_DIR}/migration-maintenance-required.sh"
LIVEKIT_GUARD_SCRIPT="${SCRIPT_DIR}/livekit-deploy-guard.sh"
LIVEKIT_GUARD_TEST="${SCRIPT_DIR}/test-livekit-deploy-guard.sh"
BOOTSTRAP_SCRIPT="${SCRIPT_DIR}/bootstrap-app-role.sh"
DOCKERFILE="${SCRIPT_DIR}/../../Dockerfile"
COMPOSE_FILE="${SCRIPT_DIR}/../../docker-compose.prod.yml"
CADDYFILE="${SCRIPT_DIR}/../../Caddyfile"
REPOSITORY_ROOT="${SCRIPT_DIR}/../../.."
PRODUCTION_WORKFLOW="${REPOSITORY_ROOT}/.github/workflows/cd-production.yml"
STAGING_WORKFLOW="${REPOSITORY_ROOT}/.github/workflows/cd-staging.yml"
ROLLBACK_WORKFLOW="${REPOSITORY_ROOT}/.github/workflows/rollback.yml"
CI_WORKFLOW="${REPOSITORY_ROOT}/.github/workflows/ci.yml"
SEARCH_MIGRATION="${SCRIPT_DIR}/../../prisma/migrations/20260810190000_search_trigram_indexes/migration.sql"
STABLE_CURSOR_MIGRATION="${SCRIPT_DIR}/../../prisma/migrations/20260810190000_stable_notification_follow_cursors/migration.sql"
OUTBOX_MIGRATION="${SCRIPT_DIR}/../../prisma/migrations/20260810213000_delivery_outbox/migration.sql"
MEDIA_MIGRATION="${SCRIPT_DIR}/../../prisma/migrations/20260810214000_media_idempotency_cleanup/migration.sql"
MEDIA_ROLLBACK_MIGRATION="${SCRIPT_DIR}/../../prisma/migrations/20260810214500_media_rollback_compatibility/migration.sql"
OUTBOX_EFFECT_MIGRATION="${SCRIPT_DIR}/../../prisma/migrations/20260810215000_outbox_effect_started_at/migration.sql"
PARTICIPANT_ADMISSION_MIGRATION="${SCRIPT_DIR}/../../prisma/migrations/20260810220000_participant_admission_lease/migration.sql"

line_number() {
  match=$(grep -nF "$2" "$1" | sed -n '1{s/:.*//;p;}')
  [ -n "$match" ] || {
    printf '%s\n' "missing deploy contract fragment: $2" >&2
    exit 1
  }
  printf '%s\n' "$match"
}

nth_line_number() {
  match=$(grep -nF "$2" "$1" | sed -n "${3}{s/:.*//;p;}")
  [ -n "$match" ] || {
    printf '%s\n' "missing deploy contract fragment occurrence ${3}: $2" >&2
    exit 1
  }
  printf '%s\n' "$match"
}

bootstrap_line=$(line_number "$DEPLOY_SCRIPT" 'run --rm --no-deps "$DB_BOOTSTRAP_SERVICE"')
maintenance_line=$(line_number "$DEPLOY_SCRIPT" 'compose_for "$file" run --rm --no-deps "$DB_MAINTENANCE_CHECK_SERVICE"')
stop_line=$(line_number "$DEPLOY_SCRIPT" 'stop "$API_SERVICE"')
migrate_line=$(line_number "$DEPLOY_SCRIPT" 'run_migrations_bounded "$file"')
grants_line=$(line_number "$DEPLOY_SCRIPT" 'run --rm --no-deps "$DB_GRANTS_SERVICE"')
label_guard_line=$(line_number "$DEPLOY_SCRIPT" 'image is incompatible with the restricted database-role contract')
livekit_label_guard_line=$(line_number "$DEPLOY_SCRIPT" 'image is incompatible with the LiveKit revocation contract')
previous_livekit_guard_line=$(line_number "$DEPLOY_SCRIPT" 'preflight_previous_api_livekit_contract "$CURRENT_CONTAINER" "$PREV_IMAGE"')
previous_database_guard_line=$(line_number "$DEPLOY_SCRIPT" 'preflight_previous_api_database_role_contract "$CURRENT_CONTAINER" "$PREV_IMAGE"')
prepare_call_line=$(line_number "$DEPLOY_SCRIPT" 'if ! prepare_database "$COMPOSE_FILE" "$NEW_IMAGE"; then')
worker_preflight_line=$(line_number "$DEPLOY_SCRIPT" 'dist/workers/livekitSecurity.worker.js')
worker_up_line=$(line_number "$DEPLOY_SCRIPT" 'up -d --no-deps "$LIVEKIT_REVOCATION_WORKER_SERVICE"')
worker_activation_line=$(line_number "$DEPLOY_SCRIPT" 'if ! activate_livekit_worker_with_contract "$COMPOSE_FILE" "$NEW_IMAGE"; then')
api_activation_line=$(line_number "$DEPLOY_SCRIPT" 'if activate_image_with_runtime_contracts "$COMPOSE_FILE" "$NEW_IMAGE"; then')
rollback_target_refusal_line=$(line_number "$DEPLOY_SCRIPT" 'Rollback target API activation failed; restoring the captured worker before exit')

[ "$bootstrap_line" -lt "$maintenance_line" ]
[ "$maintenance_line" -lt "$stop_line" ]
[ "$stop_line" -lt "$migrate_line" ]
[ "$migrate_line" -lt "$grants_line" ]
[ "$label_guard_line" -lt "$prepare_call_line" ]
[ "$livekit_label_guard_line" -lt "$prepare_call_line" ]
[ "$previous_livekit_guard_line" -lt "$prepare_call_line" ]
[ "$previous_database_guard_line" -lt "$prepare_call_line" ]
[ "$worker_preflight_line" -lt "$worker_up_line" ]
[ "$worker_activation_line" -lt "$api_activation_line" ]
rollback_target_refusal_end=$((rollback_target_refusal_line + 6))
rollback_target_refusal_block=$(sed -n "${rollback_target_refusal_line},${rollback_target_refusal_end}p" "$DEPLOY_SCRIPT")
printf '%s\n' "$rollback_target_refusal_block" | grep -Fq 'restore_previous_livekit_security_worker'
printf '%s\n' "$rollback_target_refusal_block" | grep -Fq 'rollback target activation refused'

grep -Fq 'if [ "$RUN_DATABASE_MIGRATIONS" = "true" ]' "$DEPLOY_SCRIPT"
grep -Fq 'org.chathouse.database-role-contract' "$DEPLOY_SCRIPT"
grep -Fq 'LABEL org.chathouse.database-role-contract="v1"' "$DOCKERFILE"
grep -Fq 'LABEL org.chathouse.livekit-revocation-contract="v1"' "$DOCKERFILE"
grep -Fq 'REQUIRED_LIVEKIT_REVOCATION_CONTRACT=v1' "$DEPLOY_SCRIPT"
grep -Fq 'source "$LIVEKIT_DEPLOY_GUARD"' "$DEPLOY_SCRIPT"
grep -Fq 'ALLOW_ONE_WAY_LIVEKIT_REVOCATION_UPGRADE' "$DEPLOY_SCRIPT"
grep -Fq 'ALLOW_ONE_WAY_DATABASE_ROLE_UPGRADE' "$DEPLOY_SCRIPT"
grep -Fq 'Refusing every database/API mutation' "$LIVEKIT_GUARD_SCRIPT"
grep -Fq 'scripts/deploy/livekit-deploy-guard.sh' "$PRODUCTION_WORKFLOW"
grep -Fq 'scripts/deploy/livekit-deploy-guard.sh' "$STAGING_WORKFLOW"
grep -Fq 'ALLOW_ONE_WAY_LIVEKIT_REVOCATION_UPGRADE="$ALLOW_ONE_WAY_LIVEKIT_REVOCATION_UPGRADE"' "$PRODUCTION_WORKFLOW"
grep -Fq 'ALLOW_ONE_WAY_LIVEKIT_REVOCATION_UPGRADE="$ALLOW_ONE_WAY_LIVEKIT_REVOCATION_UPGRADE"' "$STAGING_WORKFLOW"
grep -Fq 'ALLOW_ONE_WAY_DATABASE_ROLE_UPGRADE="$ALLOW_ONE_WAY_DATABASE_ROLE_UPGRADE"' "$PRODUCTION_WORKFLOW"
grep -Fq 'ALLOW_ONE_WAY_DATABASE_ROLE_UPGRADE="$ALLOW_ONE_WAY_DATABASE_ROLE_UPGRADE"' "$STAGING_WORKFLOW"
grep -Fq 'bash scripts/deploy/test-livekit-deploy-guard.sh' "$CI_WORKFLOW"
grep -Fq 'image is incompatible with the LiveKit revocation contract' "$DEPLOY_SCRIPT"
if grep -Fq 'livekit-outbox-handoff:' "$COMPOSE_FILE"; then
  printf '%s\n' 'obsolete LiveKit drain handoff service is still configured' >&2
  exit 1
fi
grep -Fq 'RUN_DATABASE_MIGRATIONS=false' "$ROLLBACK_SCRIPT"
grep -Fq 'ALLOW_ONE_WAY_LIVEKIT_REVOCATION_UPGRADE=false' "$ROLLBACK_SCRIPT"
grep -Fq 'ALLOW_ONE_WAY_DATABASE_ROLE_UPGRADE=false' "$ROLLBACK_SCRIPT"
grep -Fq '20260810190000_search_trigram_indexes' "$MAINTENANCE_SCRIPT"
grep -Fq '20260810190000_stable_notification_follow_cursors' "$MAINTENANCE_SCRIPT"
grep -Fq '20260810214000_media_idempotency_cleanup' "$MAINTENANCE_SCRIPT"
grep -Fq '20260810220000_participant_admission_lease' "$MAINTENANCE_SCRIPT"
grep -Fq ') = 4' "$MAINTENANCE_SCRIPT"
grep -Fq 'MIGRATION_COMMAND_TIMEOUT=35m' "$DEPLOY_SCRIPT"
grep -Fq -- '--kill-after="$MIGRATION_TERMINATION_GRACE"' "$DEPLOY_SCRIPT"
grep -Fq 'MIGRATION_CONTAINER_NAME="chathouse-prisma-migrate-$$"' "$DEPLOY_SCRIPT"
grep -Fq 'run --name "$MIGRATION_CONTAINER_NAME" --rm --no-deps "$DB_MIGRATION_SERVICE"' "$DEPLOY_SCRIPT"
[ "$(grep -Fc 'if ! stop_migration_container_and_wait; then' "$DEPLOY_SCRIPT")" -eq 2 ]
grep -Fq 'refusing to restart API writers' "$DEPLOY_SCRIPT"
for signal in TERM INT HUP; do
  grep -Fq "trap 'recover_interrupted_maintenance ${signal}' ${signal}" "$DEPLOY_SCRIPT"
done
grep -Fq 'activate_image_with_runtime_contracts "$COMPOSE_FILE" "$NEW_IMAGE"' "$DEPLOY_SCRIPT"
grep -Fq 'activate_image_with_runtime_contracts "$ROLLBACK_COMPOSE_FILE" "$PREV_IMAGE"' "$LIVEKIT_GUARD_SCRIPT"
grep -Fq '&& activate_previous_image' "$DEPLOY_SCRIPT"
grep -Fq 'if activate_previous_image && verify_internal_health; then' "$DEPLOY_SCRIPT"
grep -Fq 'if activate_previous_image; then' "$DEPLOY_SCRIPT"
if grep -Fq 'activate_image "$ROLLBACK_COMPOSE_FILE" "$PREV_IMAGE"' "$LIVEKIT_GUARD_SCRIPT"; then
  printf '%s\n' 'previous-image activation bypasses the LiveKit contract' >&2
  exit 1
fi
grep -Fq 'current API worker left running' "$LIVEKIT_GUARD_SCRIPT"
grep -Fq 'PREV_LIVEKIT_WORKER_IMAGE="$(livekit_worker_digest_ref' "$DEPLOY_SCRIPT"
grep -Fq 'restore_previous_livekit_security_worker' "$DEPLOY_SCRIPT"
grep -Fq 'livekit_worker_is_healthy "$COMPOSE_FILE" "$NEW_IMAGE"' "$DEPLOY_SCRIPT"
grep -Fq '&& verify_internal_health' "$DEPLOY_SCRIPT"
signal_quiescence_line=$(nth_line_number "$DEPLOY_SCRIPT" 'if ! stop_migration_container_and_wait; then' 1)
failure_quiescence_line=$(nth_line_number "$DEPLOY_SCRIPT" 'if ! stop_migration_container_and_wait; then' 2)
signal_reactivation_line=$(line_number "$DEPLOY_SCRIPT" '&& activate_previous_image')
failure_reactivation_line=$(line_number "$DEPLOY_SCRIPT" 'if activate_previous_image && verify_internal_health; then')
migration_failure_cleanup_line=$(nth_line_number "$DEPLOY_SCRIPT" 'stop_migration_container_and_wait || return 1' 2)
migration_failure_return_line=$(line_number "$DEPLOY_SCRIPT" 'return "$migration_status"')
[ "$signal_quiescence_line" -lt "$signal_reactivation_line" ]
[ "$failure_quiescence_line" -lt "$failure_reactivation_line" ]
[ "$migration_failure_cleanup_line" -lt "$migration_failure_return_line" ]

grep -Fq '  livekit-revocation-worker:' "$COMPOSE_FILE"
grep -Fq "command: ['node', 'dist/workers/livekitSecurity.worker.js']" "$COMPOSE_FILE"
grep -Fq "restart: unless-stopped" "$COMPOSE_FILE"
grep -Fq "LIVEKIT_REVOCATION_CONTRACT_VERSION: 'v1'" "$COMPOSE_FILE"
grep -Fq "condition: service_healthy" "$COMPOSE_FILE"
grep -Fq 'LIVEKIT_CONFIG: |' "$COMPOSE_FILE"
grep -Fq "api_key: '\${LIVEKIT_API_KEY}'" "$COMPOSE_FILE"
grep -Fq "'http://livekit-revocation-worker:4010/webhooks/livekit'" "$COMPOSE_FILE"
livekit_startup_block=$(sed -n '/^  livekit:/,/^    environment:/p' "$COMPOSE_FILE")
if printf '%s\n' "$livekit_startup_block" | grep -Fq 'livekit-revocation-worker'; then
  printf '%s\n' 'self-hosted LiveKit readiness has a circular worker dependency' >&2
  exit 1
fi
worker_block=$(sed -n '/^  livekit-revocation-worker:/,/^  caddy:/p' "$COMPOSE_FILE")
for forbidden_worker_env in REDIS_URL JWT_ACCESS_SECRET FIREBASE_SERVICE_ACCOUNT TWILIO_ACCOUNT_SID STRIPE_SECRET_KEY; do
  if printf '%s\n' "$worker_block" | grep -Fq "$forbidden_worker_env"; then
    printf '%s\n' "LiveKit security worker received forbidden environment: ${forbidden_worker_env}" >&2
    exit 1
  fi
done
grep -Fq 'handle /webhooks/livekit {' "$CADDYFILE"
grep -Fq 'reverse_proxy livekit-revocation-worker:4010' "$CADDYFILE"
grep -Fq "SET LOCAL statement_timeout = '30min';" "$SEARCH_MIGRATION"
grep -Fq "SET LOCAL lock_timeout = '5s';" "$MEDIA_MIGRATION"
grep -Fq "SET LOCAL statement_timeout = '30min';" "$MEDIA_MIGRATION"
for transactional_migration in \
  "$SEARCH_MIGRATION" \
  "$STABLE_CURSOR_MIGRATION" \
  "$OUTBOX_MIGRATION" \
  "$MEDIA_MIGRATION" \
  "$MEDIA_ROLLBACK_MIGRATION" \
  "$OUTBOX_EFFECT_MIGRATION" \
  "$PARTICIPANT_ADMISSION_MIGRATION"; do
  [ "$(grep -Fc 'BEGIN;' "$transactional_migration")" -eq 1 ]
  [ "$(grep -Fc 'COMMIT;' "$transactional_migration")" -eq 1 ]
done
grep -Fq "SET LOCAL lock_timeout = '5s';" "$OUTBOX_MIGRATION"
grep -Fq "SET LOCAL statement_timeout = '5min';" "$OUTBOX_MIGRATION"
grep -Fq "SET LOCAL lock_timeout = '5s';" "$MEDIA_ROLLBACK_MIGRATION"
grep -Fq "SET LOCAL statement_timeout = '5min';" "$MEDIA_ROLLBACK_MIGRATION"
grep -Fq "SET LOCAL lock_timeout = '5s';" "$OUTBOX_EFFECT_MIGRATION"
grep -Fq "SET LOCAL statement_timeout = '5min';" "$OUTBOX_EFFECT_MIGRATION"
grep -Fq "SET LOCAL lock_timeout = '5s';" "$PARTICIPANT_ADMISSION_MIGRATION"
grep -Fq "SET LOCAL statement_timeout = '15min';" "$PARTICIPANT_ADMISSION_MIGRATION"
grep -Fq -- '--wait-for-owner-idle' "$MAINTENANCE_SCRIPT"
grep -Fq 'pg_catalog.pg_stat_activity' "$MAINTENANCE_SCRIPT"
[ "$(grep -Fc 'command_timeout: 60m' "$PRODUCTION_WORKFLOW")" -eq 1 ]
[ "$(grep -Fc 'command_timeout: 60m' "$STAGING_WORKFLOW")" -eq 1 ]
[ "$(grep -Fc 'command_timeout: 15m' "$ROLLBACK_WORKFLOW")" -eq 1 ]
grep -Fq 'trap interrupt TERM INT HUP' "$PRODUCTION_WORKFLOW"
grep -Fq 'trap interrupt TERM INT HUP' "$STAGING_WORKFLOW"
begin_line=$(line_number "$BOOTSTRAP_SCRIPT" 'BEGIN;')
lock_line=$(line_number "$BOOTSTRAP_SCRIPT" 'pg_advisory_xact_lock')
revoke_line=$(line_number "$BOOTSTRAP_SCRIPT" 'REVOKE ALL PRIVILEGES ON ALL TABLES')
grant_line=$(line_number "$BOOTSTRAP_SCRIPT" 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES')
commit_line=$(line_number "$BOOTSTRAP_SCRIPT" 'COMMIT;')
[ "$begin_line" -lt "$lock_line" ]
[ "$lock_line" -lt "$revoke_line" ]
[ "$revoke_line" -lt "$grant_line" ]
[ "$grant_line" -lt "$commit_line" ]

bash "$LIVEKIT_GUARD_TEST"

printf '%s\n' "database deployment contract smoke passed"
