import { prisma } from '../../../config/database';
import { AppError } from '../../../middlewares/error.middleware';

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

    const isAuthor = msg.userId === callerId;
    let canModerate = isAuthor;

    if (!canModerate) {
      const room = await prisma.room.findUnique({
        where: { id: msg.roomId },
        select: { hostId: true },
      });
      if (!room) throw new AppError('ROOM_001');
      if (room.hostId === callerId) canModerate = true;
      if (!canModerate) {
        const participant = await prisma.participant.findUnique({
          where: { userId_roomId: { userId: callerId, roomId: msg.roomId } },
          select: { role: true, leftAt: true },
        });
        // Mirror the legacy `requireHostOrMod`: a moderator who has left the
        // room (leftAt set) no longer holds moderation powers.
        if (participant && !participant.leftAt && participant.role === 'MODERATOR') {
          canModerate = true;
        }
      }
    }

    if (!canModerate) throw new AppError('AUTH_008', 'Not allowed');

    await prisma.roomChatMessage.update({
      where: { id: messageId },
      data: { isDeleted: true },
    });

    return { id: msg.id, alreadyDeleted: false };
  },
};
