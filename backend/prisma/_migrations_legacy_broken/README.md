# Archived (broken) migration history

These six migrations are the original Prisma migration history. They are **kept
for reference only** and are intentionally NOT under `prisma/migrations/`.

## Why they were removed

They never replayed cleanly:

- `20260421_otp_and_phone` is a near-duplicate of `20260421104217_init` — it
  re-issues `CREATE TYPE "Role"`, `CREATE TABLE "User"`, `CREATE TABLE "Room"`,
  etc. Replaying init → … → otp_and_phone fails with
  `ERROR: type "Role" already exists` (`prisma migrate diff` → P3006).
- As a result `prisma migrate deploy` against a **fresh** database always
  failed, and the live schema was instead maintained with `prisma db push`
  (which ignores the migration folder). Several models had therefore drifted
  out of the migration history entirely: `Tip`, `Subscription`, `Recording`
  and the `MessageKind` / `TipStatus` / `RecordingStatus` enums existed in
  `schema.prisma` but in **no** migration.

## What replaced them

A single squashed baseline migration:

    prisma/migrations/00000000000000_init/migration.sql

generated with `prisma migrate diff --from-empty --to-schema-datamodel` and
verified to (a) apply cleanly to an empty Postgres and (b) produce **zero
drift** against `schema.prisma` (`migrate diff --from-migrations …` returns an
empty migration). `migrate deploy` now builds the entire current schema on a
fresh production database.

## Adopting the baseline on an EXISTING database

The dev/staging database that was built with `db push` already contains every
table, so do NOT run `migrate deploy` against it (it would try to re-create
existing tables). Instead, mark the baseline as already applied — once per
existing database:

    npx prisma migrate resolve --applied 00000000000000_init

Fresh databases (CI, new prod) need nothing special — `prisma migrate deploy`
applies the baseline normally.
