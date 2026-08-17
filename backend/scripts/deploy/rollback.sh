#!/usr/bin/env bash
#
# Host-side rollback of the ChatHouse API to an immutable image digest.
#
# Usage:
#   IMAGE_NAME=owner/repo/api ./rollback.sh sha256:<64 lowercase hex chars>
#   IMAGE_NAME=owner/repo/api ./rollback.sh \
#     ghcr.io/owner/repo/api@sha256:<64 lowercase hex chars>
#
# Only a digest from REGISTRY/IMAGE_NAME is accepted. If the target cannot start
# or pass health checks, deploy-image.sh restores and verifies the image that
# was running before this command.
set -Eeuo pipefail

log() { printf '%s [rollback] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

IMAGE_REF="${1:-}"
[ -n "$IMAGE_REF" ] \
  || die "missing image digest (arg 1). Usage: $0 <sha256:digest|full-repository@sha256:digest>"

DEPLOY_DIR="${DEPLOY_DIR:-/opt/chathouse/backend}"
BASE_URL="${BASE_URL:-http://localhost:4000}"
REGISTRY="${REGISTRY:-ghcr.io}"
IMAGE_NAME="${IMAGE_NAME:-}"
API_SERVICE="${API_SERVICE:-api}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
DEPLOY_IMAGE="${SCRIPT_DIR}/deploy-image.sh"

[ -n "$IMAGE_NAME" ] || die "IMAGE_NAME is required to restrict rollback to the application repository"
[[ "$REGISTRY" =~ ^[a-z0-9][a-z0-9.-]*(:[0-9]+)?$ ]] || die "invalid REGISTRY"
[[ "$IMAGE_NAME" =~ ^[a-z0-9][a-z0-9._/-]*$ ]] || die "invalid IMAGE_NAME"

# Tags are labels, not immutable identities. Accept either the bare digest or
# the exact configured repository plus digest, and reject every tag/floating
# reference.
PREFIX="${REGISTRY}/${IMAGE_NAME}@"
case "$IMAGE_REF" in
  "$PREFIX"sha256:*) DIGEST="${IMAGE_REF#"$PREFIX"}" ;;
  sha256:*) DIGEST="$IMAGE_REF" ;;
  *) die "rollback target must be '${PREFIX}sha256:<digest>' or a bare sha256 digest" ;;
esac
[[ "$DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]] \
  || die "rollback digest must be sha256 followed by exactly 64 lowercase hexadecimal characters"
IMAGE="${PREFIX}${DIGEST}"

command -v docker >/dev/null 2>&1 || die "docker not found on PATH"
[ -x "$DEPLOY_IMAGE" ] || die "deploy-image.sh not found or not executable at '${DEPLOY_IMAGE}'"

log "Activating rollback target ${IMAGE}"
DEPLOY_DIR="$DEPLOY_DIR" \
  BASE_URL="$BASE_URL" \
  API_SERVICE="$API_SERVICE" \
  RUN_DATABASE_MIGRATIONS=false \
  ACKNOWLEDGE_ONE_WAY_STATE_CONTRACT_V2_CUTOVER=false \
  ALLOW_ONE_WAY_LIVEKIT_REVOCATION_UPGRADE=false \
  ALLOW_ONE_WAY_DATABASE_ROLE_UPGRADE=false \
  bash "$DEPLOY_IMAGE" "$IMAGE"
