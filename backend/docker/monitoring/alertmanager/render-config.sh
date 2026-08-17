#!/bin/sh
set -eu

die() {
  printf '%s [alertmanager-render] ERROR: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
  exit 1
}

require_value() {
  name="$1"
  value="$2"
  [ -n "$value" ] || die "${name} is required"
  if printf '%s' "$value" | grep -q '[[:cntrl:]]'; then
    die "${name} contains a control character"
  fi
  case "$value" in
    *"'"*) die "${name} contains an unsupported quote" ;;
  esac
}

require_value SMTP_SMARTHOST "${SMTP_SMARTHOST:-}"
require_value SMTP_FROM "${SMTP_FROM:-}"
require_value SMTP_USERNAME "${SMTP_USERNAME:-}"
require_value ALERT_EMAIL_TO "${ALERT_EMAIL_TO:-}"

TEMPLATE_FILE="${TEMPLATE_FILE:-/templates/alertmanager.yml}"
OUTPUT_FILE="${OUTPUT_FILE:-/rendered/alertmanager.yml}"
[ -r "$TEMPLATE_FILE" ] || die "template is not readable: ${TEMPLATE_FILE}"

install -d -m 0755 "$(dirname "$OUTPUT_FILE")"
tmp_file="$(mktemp "$(dirname "$OUTPUT_FILE")/.alertmanager.yml.XXXXXX")"
trap 'rm -f "$tmp_file"' EXIT
umask 077

envsubst '${SMTP_SMARTHOST} ${SMTP_FROM} ${SMTP_USERNAME} ${ALERT_EMAIL_TO}' \
  < "$TEMPLATE_FILE" > "$tmp_file"
if grep -Fq '${' "$tmp_file"; then
  die "rendered configuration still contains an unresolved placeholder"
fi

chmod 0444 "$tmp_file"
mv -f "$tmp_file" "$OUTPUT_FILE"
trap - EXIT
printf '%s [alertmanager-render] rendered %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$OUTPUT_FILE"
