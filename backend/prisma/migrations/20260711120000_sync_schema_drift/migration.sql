-- Catch-up migration: realigns the migration history with schema.prisma.
--
-- The baseline (00000000000000_init) + 20260628120000_add_profile_view lagged
-- schema.prisma by several columns and enum values that had been applied to the
-- dev/prod databases out-of-band via `prisma db push`. Because the prod image
-- boots with `prisma migrate deploy` (backend/Dockerfile), a FRESH production DB
-- must be able to create these objects, while an EXISTING db-push'd DB must not
-- error on objects that already exist.
--
-- The statements below are the exact output of `prisma migrate diff`
-- (migrations -> schema.prisma), hardened to be IDEMPOTENT (IF [NOT] EXISTS /
-- guarded CREATE TYPE / drop-before-add FK) so `migrate deploy` succeeds on both
-- a fresh DB and one already carrying these columns.

-- CreateEnum (CREATE TYPE has no IF NOT EXISTS -> guard it)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FollowStatus') THEN
    CREATE TYPE "FollowStatus" AS ENUM ('PENDING', 'ACCEPTED');
  END IF;
END
$$;

-- AlterEnum: add new values. IF NOT EXISTS makes re-application a no-op. None of
-- these values is USED in this migration, so ADD VALUE is safe inside Prisma's
-- per-migration transaction on PostgreSQL 12+.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ROOM_USER_KICKED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ROOM_MESSAGE_DELETED';

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ROOM_CANCELED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ROOM_ENDED_BY_ADMIN';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FOLLOW_REQUEST';

-- AlterTable: add drifted columns (defaults backfill existing rows).
ALTER TABLE "Club"        ADD COLUMN IF NOT EXISTS "rules" VARCHAR(2000);
ALTER TABLE "Follow"      ADD COLUMN IF NOT EXISTS "status" "FollowStatus" NOT NULL DEFAULT 'ACCEPTED';
ALTER TABLE "Participant" ADD COLUMN IF NOT EXISTS "isHidden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Room"        ADD COLUMN IF NOT EXISTS "canceledAt" TIMESTAMP(3);
ALTER TABLE "Room"        ADD COLUMN IF NOT EXISTS "isLocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Room"        ADD COLUMN IF NOT EXISTS "totalAttendees" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User"        ADD COLUMN IF NOT EXISTS "dmPrivacy" VARCHAR(16) NOT NULL DEFAULT 'mutual';
ALTER TABLE "User"        ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Follow_followingId_status_idx" ON "Follow"("followingId", "status");

-- AuditLog.actorId: (NOT NULL, ON DELETE CASCADE) -> (nullable, ON DELETE SET NULL).
-- MODE-01: a purged actor must not take the append-only audit trail with them.
-- DROP NOT NULL is a no-op if already nullable; drop-before-add makes the FK swap
-- idempotent regardless of the existing constraint's delete rule.
ALTER TABLE "AuditLog" ALTER COLUMN "actorId" DROP NOT NULL;
ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_actorId_fkey";
ALTER TABLE "AuditLog" ADD  CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
