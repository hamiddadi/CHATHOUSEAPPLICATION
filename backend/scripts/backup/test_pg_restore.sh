#!/usr/bin/env bash
#
# Fast control-flow tests for pg_restore.sh. PostgreSQL and Docker are replaced
# by exported Bash functions; gzip/file discovery remain real. No production
# database or Docker daemon is contacted.
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
RESTORE_SCRIPT="${SCRIPT_DIR}/pg_restore.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/chathouse_pg_restore_test_XXXXXX")"
BACKUP_DIR="${TEST_ROOT}/backups"
mkdir -p "$BACKUP_DIR"

cleanup() {
  case "$TEST_ROOT" in
    "${TMPDIR:-/tmp}"/chathouse_pg_restore_test_*) rm -rf -- "$TEST_ROOT" ;;
    *) printf 'Refusing to remove unexpected test path: %s\n' "$TEST_ROOT" >&2 ;;
  esac
}
trap cleanup EXIT

printf 'SELECT 1;\n' | gzip -9 >"${BACKUP_DIR}/backup_20260720_120000.sql.gz"

createdb() { :; }
dropdb() { :; }

psql() {
  local args="$*"
  case "$args" in
    *"count(*) FROM pg_catalog.pg_tables"*) printf '42\n' ;;
    *"to_regclass('public._prisma_migrations')"*) printf 't\n' ;;
    *'count(*) FROM public."_prisma_migrations"'*)
      printf '%s\n' "${FAKE_FAILED_MIGRATIONS:-0}"
      ;;
    *) cat >/dev/null ;;
  esac
}

docker() {
  case "${1:-} ${2:-}" in
    "image inspect" | "network inspect") return 0 ;;
    "run --rm")
      if [[ "$*" == *"--pull=never"* \
        && "$*" == *"--network test-network"* \
        && "$*" == *"DATABASE_URL=postgresql://chathouse:p%40ss%3A%2F%3F%23%5B%5D@postgres:5432/"* \
        && "$*" == *"npx prisma migrate deploy"* \
        && "$*" == *"npx prisma migrate status"* ]]; then
        return "${FAKE_CANDIDATE_EXIT_CODE:-0}"
      fi
      printf 'unexpected docker run arguments: %s\n' "$*" >&2
      return 91
      ;;
    *) return 92 ;;
  esac
}

export -f createdb dropdb psql docker
export BACKUP_DIR

hex="$(printf '%064d' 0)"
candidate="ghcr.io/owner/repo/api@sha256:${hex}"

run_restore() {
  POSTGRES_PASSWORD='p@ss:/?#[]' \
    POSTGRES_USER=chathouse \
    POSTGRES_DB=chathouse \
    RESTORE_BACKUP=backup_20260720_120000.sql.gz \
    RESTORE_CANDIDATE_IMAGE="$candidate" \
    RESTORE_CANDIDATE_DOCKER_NETWORK=test-network \
    bash "$RESTORE_SCRIPT"
}

nominal_output="$(run_restore 2>&1)"
grep -q 'candidate migration status' <<<"$nominal_output"
printf 'nominal candidate migration validation: PASS\n'

export FAKE_FAILED_MIGRATIONS=1
if failed_output="$(run_restore 2>&1)"; then
  printf 'restore unexpectedly accepted an unfinished Prisma migration\n' >&2
  exit 1
fi
grep -q 'unfinished Prisma migration' <<<"$failed_output"
unset FAKE_FAILED_MIGRATIONS
printf 'unfinished Prisma migration rejection: PASS\n'

candidate='ghcr.io/owner/repo/api:latest'
if tag_output="$(run_restore 2>&1)"; then
  printf 'restore unexpectedly accepted a mutable image tag\n' >&2
  exit 1
fi
grep -q 'immutable repository@sha256 digest' <<<"$tag_output"
printf 'mutable candidate tag rejection: PASS\n'

candidate="ghcr.io/owner/repo/api@sha256:${hex}"
export FAKE_CANDIDATE_EXIT_CODE=42
if run_restore >/dev/null 2>&1; then
  printf 'restore unexpectedly accepted a failed candidate migration command\n' >&2
  exit 1
fi
unset FAKE_CANDIDATE_EXIT_CODE
printf 'candidate migration command failure: PASS\n'
