#!/usr/bin/env bash
# Test inputs are read by the sourced deployment guards in this shell.
# shellcheck disable=SC2034
# Deterministic tests for the sourceable LiveKit deployment/recovery decisions.
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
# shellcheck source=./state-contract-deploy-guard.sh
source "${SCRIPT_DIR}/state-contract-deploy-guard.sh"
# shellcheck source=./livekit-deploy-guard.sh
source "${SCRIPT_DIR}/livekit-deploy-guard.sh"

REQUIRED_STATE_CONTRACT=v2
REQUIRED_LIVEKIT_REVOCATION_CONTRACT=v1
REQUIRED_DATABASE_ROLE_CONTRACT=v1
ACKNOWLEDGE_ONE_WAY_STATE_CONTRACT_V2_CUTOVER=false
ALLOW_ONE_WAY_LIVEKIT_REVOCATION_UPGRADE=false
ALLOW_ONE_WAY_DATABASE_ROLE_UPGRADE=false
PREV_IMAGE_STATE_COMPATIBLE=0
PREV_IMAGE_LIVEKIT_COMPATIBLE=0
PREV_IMAGE_DATABASE_ROLE_COMPATIBLE=0
MOCK_STATE_CONTRACT=v2
MOCK_IMAGE_CONTRACT=
MOCK_DATABASE_ROLE_CONTRACT=
LOG_OUTPUT=

log() {
  LOG_OUTPUT="${LOG_OUTPUT}${LOG_OUTPUT:+|}$*"
}

image_livekit_revocation_contract() {
  printf '%s\n' "$MOCK_IMAGE_CONTRACT"
}

image_database_role_contract() {
  printf '%s\n' "$MOCK_DATABASE_ROLE_CONTRACT"
}

image_state_contract() {
  printf '%s\n' "$MOCK_STATE_CONTRACT"
}

# A pre-v1 predecessor must be rejected before the caller is allowed to mutate
# the database or replace the running API.
if preflight_previous_api_livekit_contract running-container repo/api@sha256:old; then
  printf '%s\n' 'pre-v1 rollback target unexpectedly passed the preflight' >&2
  exit 1
fi
[ "$PREV_IMAGE_LIVEKIT_COMPATIBLE" -eq 0 ]
case "$LOG_OUTPUT" in
  *'Refusing every database/API mutation'*) ;;
  *) printf '%s\n' 'pre-v1 refusal did not state the no-mutation guarantee' >&2; exit 1 ;;
esac

# The first contract cutover is intentionally one-way and must require an
# explicit operator acknowledgement. It never marks the old image compatible.
ALLOW_ONE_WAY_LIVEKIT_REVOCATION_UPGRADE=true
preflight_previous_api_livekit_contract running-container repo/api@sha256:old
[ "$PREV_IMAGE_LIVEKIT_COMPATIBLE" -eq 0 ]

ALLOW_ONE_WAY_LIVEKIT_REVOCATION_UPGRADE=false
MOCK_IMAGE_CONTRACT=v1
preflight_previous_api_livekit_contract running-container repo/api@sha256:compatible
[ "$PREV_IMAGE_LIVEKIT_COMPATIBLE" -eq 1 ]

# A LiveKit-v1 predecessor without the database-role label is still unsafe.
# This pure preflight has no mutation primitive and must refuse by default.
if preflight_previous_api_database_role_contract running-container repo/api@sha256:livekit-only; then
  printf '%s\n' 'database-role-incompatible predecessor unexpectedly passed preflight' >&2
  exit 1
fi
[ "$PREV_IMAGE_DATABASE_ROLE_COMPATIBLE" -eq 0 ]

ALLOW_ONE_WAY_DATABASE_ROLE_UPGRADE=true
preflight_previous_api_database_role_contract running-container repo/api@sha256:livekit-only
[ "$PREV_IMAGE_DATABASE_ROLE_COMPATIBLE" -eq 0 ]

ALLOW_ONE_WAY_DATABASE_ROLE_UPGRADE=false
MOCK_DATABASE_ROLE_CONTRACT=v1
preflight_previous_api_database_role_contract running-container repo/api@sha256:double-v1
[ "$PREV_IMAGE_DATABASE_ROLE_COMPATIBLE" -eq 1 ]

# Automatic API rollback revalidates every runtime contract immediately before
# the only mutating activation call.
ROLLBACK_COMPOSE_FILE=rollback-compose.yml
PREV_IMAGE=repo/api@sha256:previous-api
API_ACTIVATION_CALLS=
activate_image() {
  API_ACTIVATION_CALLS="${1}|${2}"
}

# A one-way state-v2 preflight never becomes a latent automatic rollback.
MOCK_DATABASE_ROLE_CONTRACT=v1
if activate_previous_image; then
  printf '%s\n' 'known pre-v2 predecessor unexpectedly reached activation' >&2
  exit 1
fi
[ -z "$API_ACTIVATION_CALLS" ]

PREV_IMAGE_STATE_COMPATIBLE=1
MOCK_DATABASE_ROLE_CONTRACT=
if activate_previous_image; then
  printf '%s\n' 'rollback activation accepted a missing database-role label' >&2
  exit 1
fi
[ -z "$API_ACTIVATION_CALLS" ]

MOCK_DATABASE_ROLE_CONTRACT=v1
activate_previous_image
[ "$API_ACTIVATION_CALLS" = "$ROLLBACK_COMPOSE_FILE|$PREV_IMAGE" ]

# Simulate the production sequence: the candidate worker fails its health gate,
# then rollback restores the captured previous digest.
COMPOSE_FILE=compose.yml
NEW_IMAGE=repo/api@sha256:candidate
PREV_LIVEKIT_WORKER_IMAGE=repo/api@sha256:previous-worker
RECOVERY_IMAGE="$PREV_LIVEKIT_WORKER_IMAGE"
ACTIVE_IMAGE=
CANDIDATE_CAN_START=0
ACTIVATION_ATTEMPTS=

docker() {
  [ "$1" = image ] && [ "$2" = inspect ]
}

livekit_worker_is_healthy() {
  local expected_image="${2:-}"
  [ -n "$ACTIVE_IMAGE" ] || return 1
  [ -z "$expected_image" ] || [ "$ACTIVE_IMAGE" = "$expected_image" ]
}

activate_livekit_worker_with_contract() {
  local image="$2"
  ACTIVATION_ATTEMPTS="${ACTIVATION_ATTEMPTS}${ACTIVATION_ATTEMPTS:+ }${image}"
  if [ "$image" = "$NEW_IMAGE" ] && [ "$CANDIDATE_CAN_START" -ne 1 ]; then
    return 1
  fi
  if [ "$image" != "$NEW_IMAGE" ]; then
    [ "$image" = "$RECOVERY_IMAGE" ] || return 1
  fi
  ACTIVE_IMAGE="$image"
}

if activate_livekit_worker_with_contract "$COMPOSE_FILE" "$NEW_IMAGE"; then
  printf '%s\n' 'candidate worker unexpectedly passed the simulated health gate' >&2
  exit 1
fi
restore_previous_livekit_security_worker
[ "$ACTIVE_IMAGE" = "$PREV_LIVEKIT_WORKER_IMAGE" ]
[ "$ACTIVATION_ATTEMPTS" = "$NEW_IMAGE $PREV_LIVEKIT_WORKER_IMAGE" ]

# If a contract-v1 API predates the separate Compose service, its immutable
# image is still a valid recovery worker target.
PREV_LIVEKIT_WORKER_IMAGE=
PREV_IMAGE=repo/api@sha256:previous-api
RECOVERY_IMAGE="$PREV_IMAGE"
ACTIVE_IMAGE=
ACTIVATION_ATTEMPTS=
if activate_livekit_worker_with_contract "$COMPOSE_FILE" "$NEW_IMAGE"; then
  printf '%s\n' 'candidate worker unexpectedly passed the second simulated health gate' >&2
  exit 1
fi
restore_previous_livekit_security_worker
[ "$ACTIVE_IMAGE" = "$PREV_IMAGE" ]
[ "$ACTIVATION_ATTEMPTS" = "$NEW_IMAGE $PREV_IMAGE" ]

# Even a healthy candidate must not survive an API rollback when an exact
# previous worker digest is available.
PREV_LIVEKIT_WORKER_IMAGE=repo/api@sha256:previous-worker
PREV_IMAGE=repo/api@sha256:previous-api
RECOVERY_IMAGE="$PREV_LIVEKIT_WORKER_IMAGE"
ACTIVE_IMAGE=
CANDIDATE_CAN_START=1
ACTIVATION_ATTEMPTS=
activate_livekit_worker_with_contract "$COMPOSE_FILE" "$NEW_IMAGE"
[ "$ACTIVE_IMAGE" = "$NEW_IMAGE" ]
restore_previous_livekit_security_worker
[ "$ACTIVE_IMAGE" = "$PREV_LIVEKIT_WORKER_IMAGE" ]
[ "$ACTIVATION_ATTEMPTS" = "$NEW_IMAGE $PREV_LIVEKIT_WORKER_IMAGE" ]

printf '%s\n' 'LiveKit deployment guard tests passed'
