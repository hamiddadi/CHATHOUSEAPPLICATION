#!/usr/bin/env bash
# Compatibility flags deliberately cross the source boundary into deploy-image.sh.
# shellcheck disable=SC2034
# Shared, sourceable guard for the irreversible application-state contract.
# Keep this file free of top-level side effects so every recovery decision can
# be tested without a Docker daemon.

preflight_previous_api_state_contract() {
  local current_container="$1"
  local previous_image="$2"
  local contract

  PREV_IMAGE_STATE_COMPATIBLE=0

  # A new installation has no running writer to recover.
  if [ -z "$current_container" ]; then
    return 0
  fi

  if [ -z "$previous_image" ]; then
    log "CRITICAL: the running API has no immutable state-contract rollback image"
    return 1
  fi

  contract="$(image_state_contract "$previous_image")" || {
    log "CRITICAL: unable to inspect the state contract on captured previous API image '${previous_image}'"
    return 1
  }
  if [ "$contract" = "$REQUIRED_STATE_CONTRACT" ]; then
    PREV_IMAGE_STATE_COMPATIBLE=1
    return 0
  fi

  if [ "$ACKNOWLEDGE_ONE_WAY_STATE_CONTRACT_V2_CUTOVER" = true ]; then
    log "WARNING: explicitly acknowledged irreversible state-contract v2 cutover; '${previous_image}' cannot be reactivated after database maintenance, Redis-to-Postgres state transfer, or private-media reference cutover"
    return 0
  fi

  log "CRITICAL: captured previous API image '${previous_image}' lacks state contract '${REQUIRED_STATE_CONTRACT}'"
  log "Refusing every database/API mutation; explicitly acknowledge the one-way state-contract v2 cutover or deploy a v2-compatible predecessor first"
  return 1
}

activate_image_with_state_contract() {
  local file="$1"
  local image="$2"
  local contract

  contract="$(image_state_contract "$image")" || {
    log "ERROR: unable to inspect state contract on '${image}'"
    return 1
  }
  if [ "$contract" != "$REQUIRED_STATE_CONTRACT" ]; then
    log "CRITICAL: image '${image}' lacks state contract '${REQUIRED_STATE_CONTRACT}'; pre-v2 activation and rollback are permanently refused"
    return 1
  fi
  activate_image "$file" "$image"
}
