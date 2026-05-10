-- ─── New enum for Report.targetKind ────────────────────
CREATE TYPE "ReportTargetKind" AS ENUM ('USER', 'ROOM');

-- ─── Report: add targetKind + reportedRoomId ───────────
ALTER TABLE "Report"
  ADD COLUMN "targetKind"     "ReportTargetKind" NOT NULL DEFAULT 'USER',
  ADD COLUMN "reportedRoomId" TEXT;

-- Existing rows keep targetKind=USER and reportedId set; allow reportedId nullable
-- so future ROOM reports can leave it blank. Drop the old NOT NULL constraint.
ALTER TABLE "Report" ALTER COLUMN "reportedId" DROP NOT NULL;

ALTER TABLE "Report"
  ADD CONSTRAINT "Report_reportedRoomId_fkey"
  FOREIGN KEY ("reportedRoomId") REFERENCES "Room"("id") ON DELETE CASCADE;

CREATE INDEX "Report_reportedRoomId_createdAt_idx"
  ON "Report"("reportedRoomId", "createdAt");

-- ─── New table: RoomBan ────────────────────────────────
CREATE TABLE "RoomBan" (
  "id"        TEXT NOT NULL,
  "roomId"    TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "bannedBy"  TEXT NOT NULL,
  "reason"    VARCHAR(500),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RoomBan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoomBan_roomId_userId_key" ON "RoomBan"("roomId", "userId");
CREATE INDEX "RoomBan_roomId_idx" ON "RoomBan"("roomId");
CREATE INDEX "RoomBan_userId_idx" ON "RoomBan"("userId");
CREATE INDEX "RoomBan_expiresAt_idx" ON "RoomBan"("expiresAt");

ALTER TABLE "RoomBan"
  ADD CONSTRAINT "RoomBan_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "RoomBan_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "RoomBan_bannedBy_fkey"
  FOREIGN KEY ("bannedBy") REFERENCES "User"("id") ON DELETE CASCADE;
