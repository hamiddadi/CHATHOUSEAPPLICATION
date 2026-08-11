#!/usr/bin/env bash

set -euo pipefail

readonly artifact_dir="e2e-artifacts/android"
readonly apk_path="android/app/build/outputs/apk/debug/app-debug.apk"
readonly maestro_bin="$HOME/.maestro/bin/maestro"

mkdir -p "$artifact_dir"

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

test -f "$apk_path"
test -x "$maestro_bin"
adb wait-for-device
adb reverse tcp:8081 tcp:8081
adb install -r "$apk_path"

"$maestro_bin" test \
  --format junit \
  --output "$artifact_dir/report.xml" \
  --test-output-dir "$artifact_dir/run" \
  .maestro
