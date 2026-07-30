-- Support active room-membership lookups without scanning historical rows.
CREATE INDEX "Participant_roomId_leftAt_idx"
  ON "Participant"("roomId", "leftAt");

CREATE INDEX "Participant_userId_leftAt_idx"
  ON "Participant"("userId", "leftAt");

CREATE INDEX "Participant_roomId_leftAt_role_idx"
  ON "Participant"("roomId", "leftAt", "role");

-- Support room discovery, account cleanup, and stable admin pagination.
CREATE INDEX "Room_isLive_endedAt_createdAt_idx"
  ON "Room"("isLive", "endedAt", "createdAt");

CREATE INDEX "Room_hostId_isLive_endedAt_idx"
  ON "Room"("hostId", "isLive", "endedAt");

CREATE INDEX "User_createdAt_id_idx"
  ON "User"("createdAt", "id");

CREATE INDEX "Report_resolvedAt_createdAt_id_idx"
  ON "Report"("resolvedAt", "createdAt", "id");

-- Support social lookups and cursor-paginated notification feeds.
CREATE INDEX "Follow_followerId_status_idx"
  ON "Follow"("followerId", "status");

CREATE INDEX "Notification_userId_createdAt_idx"
  ON "Notification"("userId", "createdAt");

CREATE INDEX "Notification_userId_type_createdAt_idx"
  ON "Notification"("userId", "type", "createdAt");

-- Keep unread-count indexes small: read rows never occupy these structures.
CREATE INDEX "Notification_unread_by_user_idx"
  ON "Notification"("userId")
  WHERE "isRead" = false;

CREATE INDEX "Message_unread_dm_by_receiver_idx"
  ON "Message"("receiverId")
  WHERE "isRead" = false AND "roomId" IS NULL;

-- Support both directions of a peer-to-peer DM history scan.
CREATE INDEX "Message_senderId_receiverId_createdAt_idx"
  ON "Message"("senderId", "receiverId", "createdAt");

-- Support unread group-message windows and refresh-session pruning.
CREATE INDEX "GroupMessage_conversationId_createdAt_senderId_idx"
  ON "GroupMessage"("conversationId", "createdAt", "senderId");

CREATE INDEX "RefreshToken_userId_revokedAt_expiresAt_createdAt_idx"
  ON "RefreshToken"("userId", "revokedAt", "expiresAt", "createdAt");
