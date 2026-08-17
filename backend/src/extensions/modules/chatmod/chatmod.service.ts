import { prisma } from '../../../config/database';
import { AppError } from '../../../middlewares/error.middleware';
import { auditLogService } from '../../../modules/admin/auditLog.service';
import { withLockedRoomState } from '../../../modules/rooms/room-state-lock';

/**
 * Soft-delete a room chat message. Reuses the existing `isDeleted` flag on
 * RoomChatMessage so the existing chat read path naturally hides it (or
 * replaces it with "[Message supprimé]" depending on the client renderer).
 *
 * Authorization: the caller must be (a) the message author OR (b) the
 * room host OR (c) any participant with role MODERATOR or above.
 */
export const chatmodService = {
  async deleteMessage(callerId: string, messageId: string) {
    const msg = await prisma.roomChatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, userId: true, roomId: true, isDeleted: true },
    });
    if (!msg) throw new AppError('CHAT_001', 'Message not found');
    if (msg.isDeleted) return { id: msg.id, alreadyDeleted: true };

    const deletion = await withLockedRoomState(msg.roomId, async (tx, room) => {
      if (!room) throw new AppError('ROOM_001');
      const current = await tx.roomChatMessage.findUnique({
        where: { id: messageId },
        select: { id: true, userId: true, roomId: true, isDeleted: true },
      });
      if (!current) throw new AppError('CHAT_001', 'Message not found');
      if (current.isDeleted) return { ...current, alreadyDeleted: true as const };

      let canModerate = current.userId === callerId || room.hostId === callerId;
      if (!canModerate) {
        const participant = await tx.participant.findUnique({
          where: { userId_roomId: { userId: callerId, roomId: current.roomId } },
          select: { role: true, leftAt: true },
        });
        canModerate = Boolean(
          participant && !participant.leftAt && participant.role === 'MODERATOR',
        );
      }
      if (!canModerate) throw new AppError('AUTH_008', 'Not allowed');

      await tx.roomChatMessage.update({
        where: { id: messageId },
        data: { isDeleted: true },
      });
      await auditLogService.record(
        {
          actorId: callerId,
          action: 'ROOM_MESSAGE_DELETED',
          targetUserId: current.userId,
          targetRoomId: current.roomId,
          targetType: 'roomChatMessage',
          targetId: current.id,
          metadata: { messageId: current.id },
        },
        tx,
      );
      return { ...current, alreadyDeleted: false as const };
    });

    if (deletion.alreadyDeleted) return { id: deletion.id, alreadyDeleted: true };

    return { id: deletion.id, alreadyDeleted: false };
  },
};
