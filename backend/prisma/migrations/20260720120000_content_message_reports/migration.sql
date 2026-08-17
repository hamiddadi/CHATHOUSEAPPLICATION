-- Expand the existing moderation queue to support individual direct, group
-- and in-room chat messages. Every new column is nullable, so existing report
-- rows and old application instances remain valid during a rolling deploy.

ALTER TYPE "ReportTargetKind" ADD VALUE IF NOT EXISTS 'DIRECT_MESSAGE';
ALTER TYPE "ReportTargetKind" ADD VALUE IF NOT EXISTS 'GROUP_MESSAGE';
ALTER TYPE "ReportTargetKind" ADD VALUE IF NOT EXISTS 'ROOM_MESSAGE';

ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "contentAuthorId" TEXT;
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "reportedMessageId" TEXT;
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "reportedGroupMessageId" TEXT;
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "reportedRoomMessageId" TEXT;
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "contentSnapshot" VARCHAR(4000);
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "contentAudioUrl" VARCHAR(2048);
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "contentAudioDurationMs" INTEGER;
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "contentKind" "MessageKind";
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "contentCreatedAt" TIMESTAMP(3);
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "contentContextId" TEXT;
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "contentContextSnapshot" VARCHAR(100);

CREATE INDEX IF NOT EXISTS "Report_contentAuthorId_createdAt_idx"
  ON "Report"("contentAuthorId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "Report_reporterId_reportedMessageId_key"
  ON "Report"("reporterId", "reportedMessageId");
CREATE UNIQUE INDEX IF NOT EXISTS "Report_reporterId_reportedGroupMessageId_key"
  ON "Report"("reporterId", "reportedGroupMessageId");
CREATE UNIQUE INDEX IF NOT EXISTS "Report_reporterId_reportedRoomMessageId_key"
  ON "Report"("reporterId", "reportedRoomMessageId");

ALTER TABLE "Report"
  ADD CONSTRAINT "Report_contentAuthorId_fkey"
  FOREIGN KEY ("contentAuthorId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Message target ids are immutable evidence, not live relational links. Keeping
-- them as scalar ids allows the source message to be deleted without erasing
-- either the report target or its text/audio snapshot.
ALTER TABLE "Report"
  ADD CONSTRAINT "Report_targetKind_targetColumn_check"
  CHECK (
    (
      "targetKind"::text = 'USER'
      AND "reportedId" IS NOT NULL
      AND "reportedRoomId" IS NULL
      AND "reportedMessageId" IS NULL
      AND "reportedGroupMessageId" IS NULL
      AND "reportedRoomMessageId" IS NULL
    )
    OR (
      "targetKind"::text = 'ROOM'
      AND "reportedId" IS NULL
      AND "reportedRoomId" IS NOT NULL
      AND "reportedMessageId" IS NULL
      AND "reportedGroupMessageId" IS NULL
      AND "reportedRoomMessageId" IS NULL
    )
    OR (
      "targetKind"::text = 'DIRECT_MESSAGE'
      AND "reportedId" IS NULL
      AND "reportedRoomId" IS NULL
      AND "reportedMessageId" IS NOT NULL
      AND "reportedGroupMessageId" IS NULL
      AND "reportedRoomMessageId" IS NULL
    )
    OR (
      "targetKind"::text = 'GROUP_MESSAGE'
      AND "reportedId" IS NULL
      AND "reportedRoomId" IS NULL
      AND "reportedMessageId" IS NULL
      AND "reportedGroupMessageId" IS NOT NULL
      AND "reportedRoomMessageId" IS NULL
    )
    OR (
      "targetKind"::text = 'ROOM_MESSAGE'
      AND "reportedId" IS NULL
      AND "reportedRoomId" IS NULL
      AND "reportedMessageId" IS NULL
      AND "reportedGroupMessageId" IS NULL
      AND "reportedRoomMessageId" IS NOT NULL
    )
  ) NOT VALID;

-- Existing USER/ROOM rows already use their corresponding target column.
-- Validation checks that invariant before the migration is considered applied.
ALTER TABLE "Report"
  VALIDATE CONSTRAINT "Report_targetKind_targetColumn_check";
