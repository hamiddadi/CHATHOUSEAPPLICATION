#!/bin/sh
#
# Idempotently create and harden the PostgreSQL role used by the API.
#
# This script has two supported execution modes:
#   1. /docker-entrypoint-initdb.d on a brand-new Postgres volume (local socket)
#   2. the production Compose db-role-bootstrap/db-role-grants one-shot services
#      (POSTGRES_HOST=postgres)
#
# Required environment variables are intentionally consumed from the
# environment instead of command-line arguments so passwords are not exposed in
# process listings or logs. The entire body is isolated because the official
# Postgres entrypoint sources non-executable *.sh init hooks; no option,
# positional parameter, function or temporary variable may leak into it.
(
set -eu

log() {
  printf '%s [db-role-bootstrap] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

die() {
  log "ERROR: $*"
  exit 1
}

require_env() {
  variable_name="$1"
  eval "variable_value=\${${variable_name}:-}"
  [ -n "$variable_value" ] || die "${variable_name} is required"
}

for required_variable in \
  POSTGRES_USER \
  POSTGRES_PASSWORD \
  POSTGRES_DB \
  POSTGRES_APP_USER \
  POSTGRES_APP_PASSWORD; do
  require_env "$required_variable"
done

[ "$POSTGRES_USER" != "$POSTGRES_APP_USER" ] \
  || die "POSTGRES_APP_USER must be distinct from POSTGRES_USER"
[ "$POSTGRES_PASSWORD" != "$POSTGRES_APP_PASSWORD" ] \
  || die "POSTGRES_APP_PASSWORD must be distinct from POSTGRES_PASSWORD"

export PGPASSWORD="$POSTGRES_PASSWORD"

set -- \
  --no-psqlrc \
  --quiet \
  --set=ON_ERROR_STOP=1 \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB"

if [ -n "${POSTGRES_HOST:-}" ]; then
  set -- "$@" --host="$POSTGRES_HOST" --port="${POSTGRES_PORT:-5432}"
fi

log "Applying the restricted application-role contract"

# psql's \getenv keeps both passwords out of argv. Every identifier and the
# application password is quoted server-side with format(%I/%L); no untrusted
# value is interpolated directly into SQL.
psql "$@" <<'SQL'
\getenv app_user POSTGRES_APP_USER
\getenv app_password POSTGRES_APP_PASSWORD
\getenv migration_user POSTGRES_USER
\getenv database_name POSTGRES_DB

BEGIN;
-- Serialize bootstrap/grant one-shots and make the privilege replacement
-- atomic. With ON_ERROR_STOP, any intermediate failure closes the session and
-- PostgreSQL rolls the complete transaction back instead of leaving REVOKEs
-- committed while the old API is still serving traffic.
DO $contract_lock$
BEGIN
  PERFORM pg_advisory_xact_lock(1128811330, 1);
END
$contract_lock$;

SELECT format('CREATE ROLE %I', :'app_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'app_user',
  :'app_password'
)
\gexec

-- Remove every inherited membership in case an existing role was previously
-- over-privileged. Direct grants below are the complete runtime contract.
SELECT format('REVOKE %I FROM %I', granted_role.rolname, :'app_user')
FROM pg_auth_members AS membership
JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
JOIN pg_roles AS member_role ON member_role.oid = membership.member
WHERE member_role.rolname = :'app_user'
\gexec

SELECT format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I', :'database_name', :'app_user')
\gexec
-- TEMPORARY is granted to PUBLIC by default and would otherwise let the API
-- create temporary tables despite its direct grants being restricted.
SELECT format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', :'database_name')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'database_name', :'app_user')
\gexec
SELECT format('ALTER ROLE %I IN DATABASE %I SET search_path = public', :'app_user', :'database_name')
\gexec

-- Old Postgres clusters may still grant CREATE on public to PUBLIC. Revoke it
-- explicitly so the API cannot create tables, functions, or shadow objects.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('REVOKE ALL PRIVILEGES ON SCHEMA public FROM %I', :'app_user')
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_user')
\gexec

-- Reapplying the script also removes accidental broad grants from an existing
-- installation before installing the exact DML-only privilege set.
SELECT format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', :'app_user')
\gexec
SELECT format(
  'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I',
  :'app_user'
)
\gexec

SELECT format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', :'app_user')
\gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', :'app_user')
\gexec

-- Prisma migrations are owned by POSTGRES_USER. These defaults ensure future
-- migration-created objects are immediately usable by the restricted API.
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
  :'migration_user',
  :'app_user'
)
\gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
  :'migration_user',
  :'app_user'
)
\gexec

-- The API has no reason to inspect or mutate Prisma's migration ledger.
SELECT format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', '_prisma_migrations', :'app_user')
WHERE to_regclass('public."_prisma_migrations"') IS NOT NULL
\gexec

-- ACL revocation cannot neutralize ownership. Fail the whole transaction if a
-- reused runtime role still owns persistent user objects or otherwise keeps
-- any database/schema creation capability.
SELECT CASE WHEN (
  has_database_privilege(:'app_user', :'database_name', 'CREATE')
  OR has_database_privilege(:'app_user', :'database_name', 'TEMPORARY')
  OR has_schema_privilege(:'app_user', 'public', 'CREATE')
  OR EXISTS (
    SELECT 1
    FROM pg_database AS database_object
    JOIN pg_roles AS application_role ON application_role.oid = database_object.datdba
    WHERE database_object.datname = :'database_name'
      AND application_role.rolname = :'app_user'
  )
  OR EXISTS (
    SELECT 1
    FROM pg_namespace AS namespace_object
    WHERE namespace_object.nspname <> 'information_schema'
      AND namespace_object.nspname !~ '^pg_'
      AND has_schema_privilege(:'app_user', namespace_object.oid, 'CREATE')
  )
  OR EXISTS (
    SELECT 1
    FROM pg_class AS class_object
    JOIN pg_namespace AS class_namespace ON class_namespace.oid = class_object.relnamespace
    JOIN pg_roles AS application_role ON application_role.oid = class_object.relowner
    WHERE class_namespace.nspname <> 'information_schema'
      AND class_namespace.nspname !~ '^pg_'
      AND application_role.rolname = :'app_user'
  )
  OR EXISTS (
    SELECT 1
    FROM pg_proc AS function_object
    JOIN pg_namespace AS function_namespace ON function_namespace.oid = function_object.pronamespace
    JOIN pg_roles AS application_role ON application_role.oid = function_object.proowner
    WHERE function_namespace.nspname <> 'information_schema'
      AND function_namespace.nspname !~ '^pg_'
      AND application_role.rolname = :'app_user'
  )
  OR EXISTS (
    SELECT 1
    FROM pg_type AS type_object
    JOIN pg_namespace AS type_namespace ON type_namespace.oid = type_object.typnamespace
    JOIN pg_roles AS application_role ON application_role.oid = type_object.typowner
    WHERE type_namespace.nspname <> 'information_schema'
      AND type_namespace.nspname !~ '^pg_'
      AND application_role.rolname = :'app_user'
  )
  OR EXISTS (
    SELECT 1
    FROM pg_extension AS extension_object
    JOIN pg_roles AS application_role ON application_role.oid = extension_object.extowner
    WHERE application_role.rolname = :'app_user'
  )
) THEN $failure$
DO $ddl_guard$
BEGIN
  RAISE EXCEPTION 'application role retains DDL privileges or persistent object ownership';
END
$ddl_guard$;
$failure$
END
\gexec

COMMIT;
SQL

unset PGPASSWORD
log "Restricted application-role contract applied"
)
