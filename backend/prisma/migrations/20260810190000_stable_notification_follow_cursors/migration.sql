-- Stable keyset pagination uses `(createdAt,id)` as a total order. Include the
-- equality filters first so PostgreSQL can satisfy both the predicate and the
-- descending scan from one index (a B-tree can scan in either direction).
-- Prisma 5.22 deploys this file transactionally, so PostgreSQL's CONCURRENTLY
-- form is not available on this migration path. Run this migration in the
-- scheduled database-maintenance window: ordinary CREATE INDEX keeps reads
-- available but blocks writes to each indexed table while its index is built.
-- Fail quickly instead of silently queuing behind a pre-existing long lock.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

CREATE INDEX "Follow_followerId_status_createdAt_id_idx"
  ON "Follow"("followerId", "status", "createdAt", "id");

CREATE INDEX "Follow_followingId_status_createdAt_id_idx"
  ON "Follow"("followingId", "status", "createdAt", "id");

CREATE INDEX "Notification_userId_createdAt_id_idx"
  ON "Notification"("userId", "createdAt", "id");

CREATE INDEX "Notification_userId_type_createdAt_id_idx"
  ON "Notification"("userId", "type", "createdAt", "id");

-- The new indexes have these columns as leftmost prefixes, so keeping the old
-- structures would add write amplification and storage without a new access
-- path. Drop only after every replacement has been built successfully.
DROP INDEX IF EXISTS "Follow_followerId_idx";
DROP INDEX IF EXISTS "Follow_followingId_idx";
DROP INDEX IF EXISTS "Follow_followerId_status_idx";
DROP INDEX IF EXISTS "Follow_followingId_status_idx";
DROP INDEX IF EXISTS "Notification_userId_type_idx";
DROP INDEX IF EXISTS "Notification_userId_createdAt_idx";
DROP INDEX IF EXISTS "Notification_userId_type_createdAt_idx";

COMMIT;
