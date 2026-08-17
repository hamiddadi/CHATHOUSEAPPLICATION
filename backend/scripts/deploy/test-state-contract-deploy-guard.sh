#!/usr/bin/env bash
# Test inputs are read by the sourced deployment guard in this shell.
# shellcheck disable=SC2034
# Deterministic tests for the irreversible state-contract deployment guard.
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
# shellcheck source=./state-contract-deploy-guard.sh
source "${SCRIPT_DIR}/state-contract-deploy-guard.sh"

REQUIRED_STATE_CONTRACT=v2
ACKNOWLEDGE_ONE_WAY_STATE_CONTRACT_V2_CUTOVER=false
PREV_IMAGE_STATE_COMPATIBLE=0
MOCK_STATE_CONTRACT=
LOG_OUTPUT=
API_ACTIVATION_CALLS=

log() {
  LOG_OUTPUT="${LOG_OUTPUT}${LOG_OUTPUT:+|}$*"
}

image_state_contract() {
  printf '%s\n' "$MOCK_STATE_CONTRACT"
}

activate_image() {
  API_ACTIVATION_CALLS="${1}|${2}"
}

# A pre-v2 predecessor is rejected before any caller may mutate the database
# or replace the running API.
if preflight_previous_api_state_contract running-container repo/api@sha256:old; then
  printf '%s\n' 'pre-v2 rollback target unexpectedly passed the preflight' >&2
  exit 1
fi
[ "$PREV_IMAGE_STATE_COMPATIBLE" -eq 0 ]
case "$LOG_OUTPUT" in
  *'Refusing every database/API mutation'*) ;;
  *) printf '%s\n' 'pre-v2 refusal did not state the no-mutation guarantee' >&2; exit 1 ;;
esac

# The initial cutover may proceed only after explicit acknowledgement. That
# acknowledgement never makes the predecessor a valid rollback target.
ACKNOWLEDGE_ONE_WAY_STATE_CONTRACT_V2_CUTOVER=true
preflight_previous_api_state_contract running-container repo/api@sha256:old
[ "$PREV_IMAGE_STATE_COMPATIBLE" -eq 0 ]
case "$LOG_OUTPUT" in
  *'cannot be reactivated'*) ;;
  *) printf '%s\n' 'one-way acknowledgement did not state rollback irreversibility' >&2; exit 1 ;;
esac

ACKNOWLEDGE_ONE_WAY_STATE_CONTRACT_V2_CUTOVER=false
MOCK_STATE_CONTRACT=v2
preflight_previous_api_state_contract running-container repo/api@sha256:v2
[ "$PREV_IMAGE_STATE_COMPATIBLE" -eq 1 ]

# Fresh installations do not require an artificial rollback target.
MOCK_STATE_CONTRACT=
preflight_previous_api_state_contract '' ''
[ "$PREV_IMAGE_STATE_COMPATIBLE" -eq 0 ]

# Activation is the final enforcement boundary. An acknowledgement from the
# forward cutover cannot be reused to activate a pre-v2 image.
ACKNOWLEDGE_ONE_WAY_STATE_CONTRACT_V2_CUTOVER=true
if activate_image_with_state_contract compose.yml repo/api@sha256:old; then
  printf '%s\n' 'pre-v2 activation unexpectedly passed with acknowledgement set' >&2
  exit 1
fi
[ -z "$API_ACTIVATION_CALLS" ]
case "$LOG_OUTPUT" in
  *'pre-v2 activation and rollback are permanently refused'*) ;;
  *) printf '%s\n' 'activation refusal did not state permanent rollback rejection' >&2; exit 1 ;;
esac

MOCK_STATE_CONTRACT=v1
if activate_image_with_state_contract compose.yml repo/api@sha256:v1; then
  printf '%s\n' 'state-contract v1 image unexpectedly activated' >&2
  exit 1
fi
[ -z "$API_ACTIVATION_CALLS" ]

MOCK_STATE_CONTRACT=v2
activate_image_with_state_contract compose.yml repo/api@sha256:v2
[ "$API_ACTIVATION_CALLS" = 'compose.yml|repo/api@sha256:v2' ]

printf '%s\n' 'state-contract deployment guard tests passed'
