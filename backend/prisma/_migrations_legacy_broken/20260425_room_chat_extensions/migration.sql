-- Room chat enhancements: visibility (mods-only mode) + reply threading.

CREATE TYPE "RoomChatVisibility" AS ENUM ('ALL', 'MODS_ONLY');

ALTER TABLE "Room"
  ADD COLUMN "chatVisibility" "RoomChatVisibility" NOT NULL DEFAULT 'ALL';

ALTER TABLE "RoomChatMessage"
  ADD COLUMN "replyToId" TEXT;

CREATE INDEX "RoomChatMessage_replyToId_idx" ON "RoomChatMessage"("replyToId");

ALTER TABLE "RoomChatMessage"
  ADD CONSTRAINT "RoomChatMessage_replyToId_fkey"
  FOREIGN KEY ("replyToId") REFERENCES "RoomChatMessage"("id") ON DELETE SET NULL;
