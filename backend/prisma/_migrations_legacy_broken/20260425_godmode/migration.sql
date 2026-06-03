-- ─── Enums ─────────────────────────────────────────────
CREATE TYPE "AppRole" AS ENUM ('USER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN');

CREATE TYPE "AuditAction" AS ENUM (
  'USER_ROLE_CHANGED',
  'USER_SUSPENDED',
  'USER_UNSUSPENDED',
  'USER_DELETED',
  'ROOM_FORCE_ENDED',
  'REPORT_RESOLVED',
  'REPORT_DISMISSED',
  'GODMODE_ACCESS',
  'IMPERSONATION_STARTED',
  'IMPERSONATION_ENDED'
);

-- ─── User: appRole + suspension columns ────────────────
ALTER TABLE "User"
  ADD COLUMN "appRole"          "AppRole" NOT NULL DEFAULT 'USER',
  ADD COLUMN "suspendedUntil"   TIMESTAMP(3),
  ADD COLUMN "suspensionReason" VARCHAR(500);

CREATE INDEX "User_appRole_idx"        ON "User"("appRole");
CREATE INDEX "User_suspendedUntil_idx" ON "User"("suspendedUntil");

-- ─── New table: AuditLog ───────────────────────────────
CREATE TABLE "AuditLog" (
  "id"           TEXT NOT NULL,
  "actorId"      TEXT NOT NULL,
  "action"       "AuditAction" NOT NULL,
  "targetUserId" TEXT,
  "targetRoomId" TEXT,
  "targetType"   VARCHAR(32),
  "targetId"     TEXT,
  "metadata"     JSONB,
  "ip"           VARCHAR(64),
  "userAgent"    VARCHAR(500),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_actorId_createdAt_idx"     ON "AuditLog"("actorId", "createdAt");
CREATE INDEX "AuditLog_action_createdAt_idx"      ON "AuditLog"("action", "createdAt");
CREATE INDEX "AuditLog_targetUserId_createdAt_idx" ON "AuditLog"("targetUserId", "createdAt");
CREATE INDEX "AuditLog_createdAt_idx"             ON "AuditLog"("createdAt");

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "AuditLog_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL;
