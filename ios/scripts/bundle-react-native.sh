#!/bin/bash

# Xcode Release bundle entrypoint.
#
# React Native's stock with-environment.sh sources .xcode.env.local after
# .xcode.env. A release check placed in .xcode.env can therefore be undone by a
# stale local ENVFILE override. This wrapper deliberately validates only after
# both files have been sourced, then invokes the Sentry/RN bundle scripts.

set -euo pipefail

fail() {
  echo "error: $1" >&2
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
IOS_DIR="$(cd "${PROJECT_DIR:-"$SCRIPT_DIR/.."}" && pwd -P)"
REPO_ROOT="$(cd "$IOS_DIR/.." && pwd -P)"

# Preserve the values supplied by Xcode itself. In particular, a local shell
# customization must not be able to turn an iphoneos Release into a simulator
# build for the purpose of bypassing the production guard.
XCODE_CONFIGURATION="${CONFIGURATION:-}"
XCODE_PLATFORM_NAME="${PLATFORM_NAME:-}"
XCODE_PROJECT_DIR="${PROJECT_DIR:-$IOS_DIR}"

BASE_ENV_PATH="$IOS_DIR/.xcode.env"
LOCAL_ENV_PATH="$IOS_DIR/.xcode.env.local"

if [[ -f "$BASE_ENV_PATH" ]]; then
  # shellcheck disable=SC1090
  source "$BASE_ENV_PATH"
fi
if [[ -f "$LOCAL_ENV_PATH" ]]; then
  # shellcheck disable=SC1090
  source "$LOCAL_ENV_PATH"
fi

export CONFIGURATION="$XCODE_CONFIGURATION"
export PLATFORM_NAME="$XCODE_PLATFORM_NAME"
export PROJECT_DIR="$XCODE_PROJECT_DIR"

if [[ -z "${NODE_BINARY:-}" ]]; then
  NODE_BINARY="$(command -v node || true)"
fi
[[ -n "${NODE_BINARY:-}" ]] || fail "Node was not found; configure NODE_BINARY in ios/.xcode.env.local."
export NODE_BINARY

trim_value() {
  local value="${1//$'\r'/}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [[ ${#value} -ge 2 ]]; then
    if [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
      value="${value:1:${#value}-2}"
    fi
  fi
  printf '%s' "$value"
}

env_file_value() {
  local env_path="$1"
  local key="$2"
  local line
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$env_path" | tail -n 1 || true)"
  [[ -n "$line" ]] || return 1
  trim_value "${line#*=}"
}

contains_placeholder() {
  local value
  value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  [[ "$value" =~ change[_-]?me|placeholder|replace[-_.]?with|your[-_.]?project|example\.(com|net|org|test)|__[a-z0-9_-]+__ ]]
}

url_host() {
  local url="$1"
  local authority="${url#*://}"
  authority="${authority%%/*}"
  authority="${authority%%\?*}"
  authority="${authority%%\#*}"
  [[ "$authority" != *"@"* ]] || return 1

  if [[ "$authority" == \[* ]]; then
    [[ "$authority" =~ ^\[([^]]+)\](:([0-9]{1,5}))?$ ]] || return 1
    if [[ -n "${BASH_REMATCH[3]:-}" ]]; then
      local port="${BASH_REMATCH[3]}"
      ((10#$port >= 1 && 10#$port <= 65535)) || return 1
    fi
    printf '%s' "${BASH_REMATCH[1]}"
  else
    # Unbracketed IPv6 is ambiguous and invalid in a URL authority.
    [[ "${authority//[^:]}" != "::" && "${authority//[^:]}" != *":::"* ]] || return 1
    local host="${authority%%:*}"
    local suffix="${authority#"$host"}"
    if [[ -n "$suffix" ]]; then
      [[ "$suffix" =~ ^:([0-9]{1,5})$ ]] || return 1
      local port="${BASH_REMATCH[1]}"
      ((10#$port >= 1 && 10#$port <= 65535)) || return 1
    fi
    printf '%s' "$host"
  fi
}

is_private_or_local_host() {
  local host
  host="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  [[ -z "$host" ]] ||
    [[ "$host" == "localhost" || "$host" == *".localhost" ]] ||
    [[ "$host" =~ ^127\. ]] ||
    [[ "$host" == "0.0.0.0" ]] ||
    [[ "$host" =~ ^10\. ]] ||
    [[ "$host" =~ ^172\.(1[6-9]|2[0-9]|3[01])\. ]] ||
    [[ "$host" =~ ^192\.168\. ]] ||
    [[ "$host" =~ ^169\.254\. ]] ||
    [[ "$host" == "::1" ]] ||
    [[ "$host" == "0:0:0:0:0:0:0:1" ]] ||
    [[ "$host" =~ ^::ffff:127\. ]] ||
    [[ "$host" =~ ^f[cd][0-9a-f]{2}: ]] ||
    [[ "$host" =~ ^fe[89ab][0-9a-f]: ]]
}

validate_public_url() {
  local label="$1"
  local value="$2"
  local scheme="$3"
  [[ "$value" == "${scheme}://"* ]] || fail "$label must use ${scheme}:// in a production archive."
  [[ "$value" != *[[:space:]]* ]] || fail "$label is malformed in .env.production."
  if contains_placeholder "$value"; then
    fail "$label still contains a placeholder."
  fi

  local host
  host="$(url_host "$value")" || fail "$label must not contain URL credentials."
  [[ -n "$host" ]] || fail "$label has no valid host."
  [[ "$host" == *.* || "$host" == *:* ]] ||
    fail "$label must not use a single-label/internal host."
  if is_private_or_local_host "$host"; then
    fail "$label must use a public production host."
  fi
  return 0
}

plist_value() {
  local plist="$1"
  local key="$2"
  /usr/libexec/PlistBuddy -c "Print :${key}" "$plist" 2>/dev/null || true
}

validate_firebase_plist() {
  local plist="$IOS_DIR/ChatHouse/GoogleService-Info.plist"
  [[ -f "$plist" ]] || fail "The real ios/ChatHouse/GoogleService-Info.plist is required."
  [[ -x /usr/libexec/PlistBuddy ]] || fail "PlistBuddy is required to validate Firebase configuration."

  local expected_bundle_id="${PRODUCT_BUNDLE_IDENTIFIER:-com.chathouse.app}"
  local bundle_id
  local project_id
  local sender_id
  local app_id
  local api_key
  local gcm_enabled
  bundle_id="$(plist_value "$plist" BUNDLE_ID)"
  project_id="$(plist_value "$plist" PROJECT_ID)"
  sender_id="$(plist_value "$plist" GCM_SENDER_ID)"
  app_id="$(plist_value "$plist" GOOGLE_APP_ID)"
  api_key="$(plist_value "$plist" API_KEY)"
  gcm_enabled="$(plist_value "$plist" IS_GCM_ENABLED)"

  [[ "$expected_bundle_id" == "com.chathouse.app" ]] ||
    fail "The Xcode product bundle identifier must be com.chathouse.app."
  [[ "$bundle_id" == "$expected_bundle_id" ]] ||
    fail "GoogleService-Info.plist does not match the Xcode bundle identifier."
  [[ "$project_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]+$ ]] ||
    fail "GoogleService-Info.plist has no valid Firebase project ID."
  [[ "$sender_id" =~ ^[0-9]+$ ]] ||
    fail "GoogleService-Info.plist has no valid Firebase sender ID."
  [[ "$app_id" =~ ^[0-9]+:[0-9]+:ios:[0-9A-Fa-f]+$ ]] ||
    fail "GoogleService-Info.plist has no valid Firebase iOS app ID."
  [[ "$api_key" =~ ^AIza[0-9A-Za-z_-]{35}$ ]] ||
    fail "GoogleService-Info.plist has no valid Firebase API key."
  [[ "$gcm_enabled" == "true" || "$gcm_enabled" == "YES" ]] ||
    fail "Firebase Cloud Messaging must be enabled for the iOS app."
  if contains_placeholder "$project_id"; then
    fail "GoogleService-Info.plist is still a placeholder."
  fi
  return 0
}

if [[ "$XCODE_CONFIGURATION" == "Release" ]]; then
  export ENVFILE="${ENVFILE:-.env.production}"

  # Release simulator builds remain available for compile-only CI. Every device
  # Release (including Archive) must pass the complete production validation.
  if [[ "$XCODE_PLATFORM_NAME" != "iphonesimulator" ]]; then
    [[ "$ENVFILE" == ".env.production" ]] ||
      fail "iOS device Release builds require ENVFILE=.env.production."

    PROD_ENV_PATH="$REPO_ROOT/.env.production"
    [[ -f "$PROD_ENV_PATH" ]] || fail ".env.production is required for an iOS Release archive."

    PROD_ENV="$(env_file_value "$PROD_ENV_PATH" ENV || true)"
    API_BASE_URL="$(env_file_value "$PROD_ENV_PATH" API_BASE_URL || true)"
    WS_BASE_URL="$(env_file_value "$PROD_ENV_PATH" WS_BASE_URL || true)"
    LIVEKIT_URL="$(env_file_value "$PROD_ENV_PATH" LIVEKIT_URL || true)"
    REALTIME_ENABLED="$(env_file_value "$PROD_ENV_PATH" REALTIME_ENABLED || true)"

    [[ "$PROD_ENV" == "production" ]] || fail ".env.production must contain ENV=production."
    [[ "$REALTIME_ENABLED" == "true" ]] ||
      fail ".env.production must contain REALTIME_ENABLED=true."
    [[ -n "$LIVEKIT_URL" ]] || fail ".env.production must define LIVEKIT_URL."
    validate_public_url API_BASE_URL "$API_BASE_URL" https
    validate_public_url WS_BASE_URL "$WS_BASE_URL" wss
    validate_public_url LIVEKIT_URL "$LIVEKIT_URL" wss
    validate_firebase_plist
  fi
fi

export ENTRY_FILE="${ENTRY_FILE:-"$REPO_ROOT/index.ts"}"
REACT_NATIVE_PATH="${REACT_NATIVE_PATH:-"$REPO_ROOT/node_modules/react-native"}"
REACT_NATIVE_XCODE="$REACT_NATIVE_PATH/scripts/react-native-xcode.sh"
SENTRY_XCODE="$REPO_ROOT/node_modules/@sentry/react-native/scripts/sentry-xcode.sh"

[[ -f "$REACT_NATIVE_XCODE" ]] || fail "React Native Xcode bundling script is missing."
[[ -f "$SENTRY_XCODE" ]] || fail "Sentry Xcode bundling wrapper is missing."

if [[ -z "${SENTRY_AUTH_TOKEN:-}" ]]; then
  export SENTRY_DISABLE_AUTO_UPLOAD=true
fi

exec /bin/bash "$SENTRY_XCODE" "$REACT_NATIVE_XCODE"
