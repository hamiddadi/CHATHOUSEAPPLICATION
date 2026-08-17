#!/bin/sh
# Prove that bootstrap-app-role.sh is safe when Postgres sources a non-executable
# init hook instead of launching it as a separate process.
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
BOOTSTRAP_SCRIPT="${SCRIPT_DIR}/bootstrap-app-role.sh"

[ -f "$BOOTSTRAP_SCRIPT" ] || {
  printf '%s\n' "bootstrap script not found" >&2
  exit 1
}

# Stub psql without a filesystem fixture. The function is visible inside the
# bootstrap subshell and consumes the heredoc exactly like the real client.
psql() {
  while IFS= read -r _line; do :; done
}

POSTGRES_USER=migration_test
POSTGRES_PASSWORD=migration_password_test
POSTGRES_DB=chathouse_test
POSTGRES_APP_USER=application_test
POSTGRES_APP_PASSWORD=application_password_test
PGPASSWORD=caller_value
export POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
export POSTGRES_APP_USER POSTGRES_APP_PASSWORD PGPASSWORD

set -- caller_arg_one caller_arg_two
options_before=$-

# shellcheck disable=SC1090
. "$BOOTSTRAP_SCRIPT"

[ "$#" -eq 2 ]
[ "$1" = caller_arg_one ]
[ "$2" = caller_arg_two ]
[ "$-" = "$options_before" ]
[ "$PGPASSWORD" = caller_value ]
if command -v log >/dev/null 2>&1 || command -v die >/dev/null 2>&1; then
  printf '%s\n' "bootstrap functions leaked into the sourcing shell" >&2
  exit 1
fi

printf '%s\n' "bootstrap source-isolation smoke passed"
