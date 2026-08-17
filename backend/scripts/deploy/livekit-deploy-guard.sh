#!/usr/bin/env bash
# Compatibility flags deliberately cross the source boundary into deploy-image.sh.
# shellcheck disable=SC2034
# Shared, sourceable guards for deploy-image.sh. Keep this file free of
# top-level side effects so the recovery decisions can be exercised without a
# Docker daemon.

preflight_previous_api_livekit_contract() {
  local current_container="$1"
  local previous_image="$2"
  local contract

  PREV_IMAGE_LIVEKIT_COMPATIBLE=0

  # A new installation has no running writer to recover.
  if [ -z "$current_container" ]; then
    return 0
  fi

  if [ -z "$previous_image" ]; then
    log "CRITICAL: the running API has no immutable rollback image"
    return 1
  fi

  contract="$(image_livekit_revocation_contract "$previous_image")" || {
    log "CRITICAL: unable to inspect the LiveKit contract on the captured previous API image '${previous_image}'"
    return 1
  }
  if [ "$contract" = "$REQUIRED_LIVEKIT_REVOCATION_CONTRACT" ]; then
    PREV_IMAGE_LIVEKIT_COMPATIBLE=1
    return 0
  fi

  if [ "$ALLOW_ONE_WAY_LIVEKIT_REVOCATION_UPGRADE" = true ]; then
    log "WARNING: explicitly authorized one-way LiveKit contract bootstrap; '${previous_image}' cannot be reactivated after API replacement or maintenance shutdown"
    return 0
  fi

  log "CRITICAL: captured previous API image '${previous_image}' lacks LiveKit revocation contract '${REQUIRED_LIVEKIT_REVOCATION_CONTRACT}'"
  log "Refusing every database/API mutation; follow the documented one-way bootstrap procedure or deploy a compatible predecessor first"
  return 1
}

preflight_previous_api_database_role_contract() {
  local current_container="$1"
  local previous_image="$2"
  local contract

  PREV_IMAGE_DATABASE_ROLE_COMPATIBLE=0
  if [ -z "$current_container" ]; then
    return 0
  fi
  if [ -z "$previous_image" ]; then
    log "CRITICAL: the running API has no immutable database-role rollback image"
    return 1
  fi

  contract="$(image_database_role_contract "$previous_image")" || {
    log "CRITICAL: unable to inspect the database-role contract on captured previous API image '${previous_image}'"
    return 1
  }
  if [ "$contract" = "$REQUIRED_DATABASE_ROLE_CONTRACT" ]; then
    PREV_IMAGE_DATABASE_ROLE_COMPATIBLE=1
    return 0
  fi

  if [ "$ALLOW_ONE_WAY_DATABASE_ROLE_UPGRADE" = true ]; then
    log "WARNING: explicitly authorized one-way database-role contract bootstrap; '${previous_image}' cannot be reactivated after role/grant mutation or API replacement"
    return 0
  fi

  log "CRITICAL: captured previous API image '${previous_image}' lacks database-role contract '${REQUIRED_DATABASE_ROLE_CONTRACT}'"
  log "Refusing every database/API mutation; follow the documented one-way database-role bootstrap procedure"
  return 1
}

activate_image_with_livekit_contract() {
  local file="$1"
  local image="$2"
  local contract

  contract="$(image_livekit_revocation_contract "$image")" || {
    log "ERROR: unable to inspect LiveKit revocation contract on '${image}'"
    return 1
  }
  if [ "$contract" != "$REQUIRED_LIVEKIT_REVOCATION_CONTRACT" ]; then
    log "CRITICAL: image '${image}' lacks LiveKit revocation contract '${REQUIRED_LIVEKIT_REVOCATION_CONTRACT}'; activation refused and current API worker left running"
    return 1
  fi
  activate_image_with_state_contract "$file" "$image"
}

activate_image_with_runtime_contracts() {
  local file="$1"
  local image="$2"
  local contract

  contract="$(image_database_role_contract "$image")" || {
    log "ERROR: unable to inspect database-role contract on '${image}'"
    return 1
  }
  if [ "$contract" != "$REQUIRED_DATABASE_ROLE_CONTRACT" ]; then
    log "CRITICAL: image '${image}' lacks database-role contract '${REQUIRED_DATABASE_ROLE_CONTRACT}'; activation refused"
    return 1
  fi
  activate_image_with_livekit_contract "$file" "$image"
}

activate_previous_image() {
  [ -n "${PREV_IMAGE:-}" ] || return 1
  if [ "${PREV_IMAGE_STATE_COMPATIBLE:-0}" -ne 1 ]; then
    log "CRITICAL: captured previous API is pre-v2; irreversible state cutover forbids automatic reactivation"
    return 1
  fi
  activate_image_with_runtime_contracts "$ROLLBACK_COMPOSE_FILE" "$PREV_IMAGE"
}

ensure_livekit_security_worker() {
  local candidate

  if livekit_worker_is_healthy "$COMPOSE_FILE"; then
    return 0
  fi

  log "LiveKit security worker is not healthy; attempting fail-closed recovery"
  # Once a candidate has failed its preflight/health gate, restore the captured
  # known-good worker first. A compatible previous API digest contains the same
  # worker entrypoint and covers upgrades where no worker container existed;
  # NEW_IMAGE remains the one-way bootstrap fallback.
  for candidate in \
    "${PREV_LIVEKIT_WORKER_IMAGE:-}" \
    "${PREV_IMAGE:-}" \
    "$NEW_IMAGE"; do
    [ -n "$candidate" ] || continue
    if docker image inspect "$candidate" >/dev/null 2>&1 \
      && activate_livekit_worker_with_contract "$COMPOSE_FILE" "$candidate"; then
      return 0
    fi
  done
  log "CRITICAL: no contract-v1 LiveKit security worker could be made healthy"
  return 1
}

restore_previous_livekit_security_worker() {
  local candidate

  # Rollback means restoring the captured worker image, not merely accepting a
  # still-healthy candidate. PREV_IMAGE is a safe secondary source when its v1
  # image predates creation of the dedicated Compose worker service.
  for candidate in "${PREV_LIVEKIT_WORKER_IMAGE:-}" "${PREV_IMAGE:-}"; do
    [ -n "$candidate" ] || continue
    if livekit_worker_is_healthy "$COMPOSE_FILE" "$candidate"; then
      return 0
    fi
    if docker image inspect "$candidate" >/dev/null 2>&1 \
      && activate_livekit_worker_with_contract "$COMPOSE_FILE" "$candidate"; then
      return 0
    fi
  done

  # A brand-new or explicitly one-way cutover has no compatible predecessor.
  # Preserve a healthy v1 candidate (or retry it) so recovery still fails
  # closed on worker availability.
  log "No compatible previous LiveKit worker is restorable; checking the v1 candidate fallback"
  ensure_livekit_security_worker
}
