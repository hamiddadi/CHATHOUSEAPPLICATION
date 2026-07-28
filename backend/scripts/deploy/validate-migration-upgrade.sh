#!/usr/bin/env bash
#
# Apply the candidate image's Prisma migrations to a disposable clone of the
# production database. This complements fresh-database CI and detects upgrade
# failures caused by real migration history/data shape.
#
# Usage:
#   MIGRATION_CLONE_ENV_FILE=/secure/clone.env \
#   MIGRATION_CLONE_CONFIRMED=disposable-clone \
#   ./validate-migration-upgrade.sh \
#     ghcr.io/owner/repo/api@sha256:<64 lowercase hex chars>
#
# clone.env must contain DATABASE_URL for the isolated clone only.
set -Eeuo pipefail

log() { printf '%s [migration-upgrade] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

IMAGE="${1:-}"
ENV_FILE="${MIGRATION_CLONE_ENV_FILE:-}"
NETWORK="${MIGRATION_CLONE_DOCKER_NETWORK:-backend_default}"

[ -n "$IMAGE" ] || die "missing candidate image ref (arg 1)"
[[ "$IMAGE" =~ ^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$ ]] \
  || die "candidate image must be an immutable repository@sha256 digest"
[ "${MIGRATION_CLONE_CONFIRMED:-}" = "disposable-clone" ] \
  || die "set MIGRATION_CLONE_CONFIRMED=disposable-clone after verifying the target is isolated"
[ -f "$ENV_FILE" ] || die "MIGRATION_CLONE_ENV_FILE must point to a readable env file"
grep -qE '^DATABASE_URL=postgres(ql)?://' "$ENV_FILE" \
  || die "clone env file must define a PostgreSQL DATABASE_URL"

command -v docker >/dev/null 2>&1 || die "docker not found on PATH"

log "Pulling candidate image ${IMAGE}"
docker pull "$IMAGE"
log "Applying and verifying migrations on the disposable production clone"
docker run --rm \
  --network "$NETWORK" \
  --env-file "$ENV_FILE" \
  --entrypoint /usr/bin/tini \
  "$IMAGE" \
  -- sh -ceu '
    pre_status_rc=0
    npx prisma migrate status || pre_status_rc=$?
    if [ "$pre_status_rc" -ne 0 ]; then
      echo "Pre-deploy migrate status exited ${pre_status_rc}; pending migrations are expected for an upgrade drill." >&2
    fi
    npx prisma migrate deploy
    npx prisma migrate status
  '
log "Migration upgrade drill passed"
