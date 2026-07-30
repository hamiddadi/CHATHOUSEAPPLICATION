-- Support active room-membership lookups without scanning historical rows.
CREATE INDEX "Participant_roomId_leftAt_idx"
  ON "Participant"("roomId", "leftAt");

CREATE INDEX "Participant_userId_leftAt_idx"
  ON "Participant"("userId", "leftAt");

-- Support unread group-message windows and refresh-session pruning.
CREATE INDEX "GroupMessage_conversationId_createdAt_senderId_idx"
  ON "GroupMessage"("conversationId", "createdAt", "senderId");

CREATE INDEX "RefreshToken_userId_revokedAt_expiresAt_createdAt_idx"
  ON "RefreshToken"("userId", "revokedAt", "expiresAt", "createdAt");
