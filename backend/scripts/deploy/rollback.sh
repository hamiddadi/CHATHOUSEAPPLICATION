#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# rollback.sh — host-side rollback of the ChatHouse API to a known-good image.
#
# Run this ON the deploy host (it talks to the local docker daemon + compose
# stack). It is the same routine the CD workflows invoke for their in-pipeline
# auto-rollback, exposed as a standalone script for manual/on-call use.
#
# Steps:
#   1. docker pull the requested image tag
#   2. point compose at it (CHATHOUSE_API_IMAGE) and recreate ONLY the api
#      service (postgres/redis stay up)
#   3. run health-check.sh against the API
#   4. exit non-zero if the rolled-back image is unhealthy
#
# Usage:
#   ./rollback.sh ghcr.io/owner/repo/api:v1.4.1
#   ./rollback.sh v1.4.1                 # bare tag → expanded via REGISTRY+IMAGE_NAME
#
# Env:
#   DEPLOY_DIR     dir containing docker-compose.yml  (default /opt/chathouse/backend)
#   BASE_URL       API base URL for health-check      (default http://localhost:4000)
#   REGISTRY       registry for bare-tag expansion    (default ghcr.io)
#   IMAGE_NAME     image path for bare-tag expansion  (e.g. owner/repo/api)
#   API_SERVICE    compose service name               (default api)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

log() { printf '%s [rollback] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

IMAGE_TAG="${1:-}"
[ -n "$IMAGE_TAG" ] || die "missing IMAGE_TAG (arg 1). Usage: $0 <image-ref-or-tag>"

DEPLOY_DIR="${DEPLOY_DIR:-/opt/chathouse/backend}"
BASE_URL="${BASE_URL:-http://localhost:4000}"
REGISTRY="${REGISTRY:-ghcr.io}"
IMAGE_NAME="${IMAGE_NAME:-}"
API_SERVICE="${API_SERVICE:-api}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
HEALTH_CHECK="${SCRIPT_DIR}/health-check.sh"

# Expand a bare tag (no slash) into a full registry ref when IMAGE_NAME is set.
case "$IMAGE_TAG" in
  */*) IMAGE="$IMAGE_TAG" ;;
  *)
    [ -n "$IMAGE_NAME" ] || die "bare tag '${IMAGE_TAG}' given but IMAGE_NAME not set for expansion"
    IMAGE="${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"
    ;;
esac

command -v docker >/dev/null 2>&1 || die "docker not found on PATH"
[ -d "$DEPLOY_DIR" ] || die "DEPLOY_DIR '${DEPLOY_DIR}' does not exist"

cd "$DEPLOY_DIR"

PREV_IMAGE="$(docker inspect --format '{{.Config.Image}}' chathouse-api 2>/dev/null || echo '')"
log "Currently running image: ${PREV_IMAGE:-<none>}"
log "Rolling back to:        ${IMAGE}"

log "Pulling ${IMAGE}"
docker pull "$IMAGE"

export CHATHOUSE_API_IMAGE="$IMAGE"
log "Recreating ${API_SERVICE} service"
docker compose up -d --no-deps --pull always "$API_SERVICE" \
  || docker compose up -d --no-deps "$API_SERVICE"

# Verify the rolled-back image is healthy before declaring success.
if [ -x "$HEALTH_CHECK" ]; then
  log "Running health-check.sh against ${BASE_URL}"
  if BASE_URL="$BASE_URL" bash "$HEALTH_CHECK"; then
    log "Rollback to ${IMAGE} succeeded (health OK)"
    exit 0
  else
    log "Rollback target ${IMAGE} is UNHEALTHY — manual intervention required"
    exit 1
  fi
else
  die "health-check.sh not found or not executable at ${HEALTH_CHECK}"
fi
