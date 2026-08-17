#!/usr/bin/env bash

set -euo pipefail

readonly artifact_dir="e2e-artifacts/ios"
readonly app_path="ios/build/Build/Products/Debug-iphonesimulator/ChatHouse.app"
readonly maestro_bin="$HOME/.maestro/bin/maestro"

: "${IOS_SIMULATOR_UDID:?IOS_SIMULATOR_UDID is required}"

mkdir -p "$artifact_dir"
test -d "$app_path"
test -x "$maestro_bin"

metro_pid=""
cleanup() {
  local exit_code=$?

  if [[ -n "$metro_pid" ]] && kill -0 "$metro_pid" 2>/dev/null; then
    kill "$metro_pid" 2>/dev/null || true
    wait "$metro_pid" 2>/dev/null || true
  fi

  exit "$exit_code"
}
trap cleanup EXIT

ENVFILE=.env.test npm start -- --reset-cache >"$artifact_dir/metro.log" 2>&1 &
metro_pid=$!

metro_ready=false
for _ in {1..60}; do
  if curl -fsS http://127.0.0.1:8081/status >/dev/null; then
    metro_ready=true
    break
  fi

  if ! kill -0 "$metro_pid" 2>/dev/null; then
    echo "Metro exited before becoming ready. See $artifact_dir/metro.log." >&2
    exit 1
  fi

  sleep 2
done

if [[ "$metro_ready" != true ]]; then
  echo "Metro did not become ready within 120 seconds. See $artifact_dir/metro.log." >&2
  exit 1
fi

# A cold React Native bundle can exceed the first UI assertion timeout on a
# hosted runner. Populate Metro's transform cache before Maestro launches.
curl --fail --show-error --silent \
  --retry 2 \
  --retry-all-errors \
  --max-time 600 \
  'http://127.0.0.1:8081/index.bundle?platform=ios&dev=true&lazy=true&minify=false&inlineSourceMap=false&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&app=com.chathouse.app' \
  --output /dev/null

install_app() {
  xcrun simctl install "$IOS_SIMULATOR_UDID" "$app_path"
}

run_maestro_attempt() {
  local attempt="$1"
  local attempt_dir="$artifact_dir/run/attempt-$attempt"

  mkdir -p "$attempt_dir"
  "$maestro_bin" --device "$IOS_SIMULATOR_UDID" test \
    --format junit \
    --output "$artifact_dir/report-attempt-$attempt.xml" \
    --test-output-dir "$attempt_dir" \
    .maestro
}

flow_started() {
  local attempt="$1"
  local attempt_dir="$artifact_dir/run/attempt-$attempt"
  local flow_artifact

  [[ -s "$artifact_dir/report-attempt-$attempt.xml" ]] && return 0
  flow_artifact="$({
    find "$attempt_dir" -type f \
      \( -name commands.json -o -name manifest.json \) \
      -print -quit 2>/dev/null || true
  })"
  [[ -n "$flow_artifact" ]]
}

publish_report() {
  local attempt="$1"
  local attempt_report="$artifact_dir/report-attempt-$attempt.xml"

  if [[ -s "$attempt_report" ]]; then
    cp "$attempt_report" "$artifact_dir/report.xml"
  fi
}

install_app

set +e
run_maestro_attempt 1
status=$?
set -e

if ((status == 0)); then
  publish_report 1
  exit 0
fi

# A report or commands manifest proves that the driver reached a real flow.
# Assertions and application crashes are terminal: never hide them with a retry.
if flow_started 1; then
  publish_report 1
  exit "$status"
fi

echo "Maestro iOS failed before any flow; rebooting the simulator and retrying the driver once." >&2
xcrun simctl shutdown "$IOS_SIMULATOR_UDID" || true
xcrun simctl boot "$IOS_SIMULATOR_UDID"
xcrun simctl bootstatus "$IOS_SIMULATOR_UDID" -b
install_app

set +e
run_maestro_attempt 2
status=$?
set -e
publish_report 2
exit "$status"
