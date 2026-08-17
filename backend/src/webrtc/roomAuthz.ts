import { prisma } from '../config/database';

/**
 * Guard used by `rtc:*` socket events — a user may only create transports
 * / produce / consume in a room they are currently joined to.
 * Phase 5 hardening: previously any authenticated socket could touch any
 * room's router. Now we require an active Participant row (leftAt IS NULL).
 */
export const isActiveRoomParticipant = async (roomId: string, userId: string): Promise<boolean> => {
  const row = await prisma.participant.findFirst({
    where: {
      roomId,
      userId,
      leftAt: null,
      admissionConfirmedAt: { not: null },
      room: { isLive: true, endedAt: null },
    },
    select: { id: true },
  });
  return row !== null;
};

/**
 * Returns true only when the user has the right to publish audio in the
 * room (HOST, MODERATOR, or SPEAKER). Listeners cannot produce — without
 * this guard, any room member could bypass the stage promotion flow by
 * directly emitting `rtc:produce`.
 */
export const canPublishInRoom = async (roomId: string, userId: string): Promise<boolean> => {
  const row = await prisma.participant.findUnique({
    where: { userId_roomId: { roomId, userId } },
    select: {
      role: true,
      leftAt: true,
      admissionConfirmedAt: true,
      room: { select: { hostId: true, isLive: true, endedAt: true } },
    },
  });
  return (
    row !== null &&
    row.leftAt === null &&
    row.admissionConfirmedAt !== null &&
    row.room.isLive &&
    row.room.endedAt === null &&
    (row.room.hostId === userId || row.role === 'MODERATOR' || row.role === 'SPEAKER')
  );
};
