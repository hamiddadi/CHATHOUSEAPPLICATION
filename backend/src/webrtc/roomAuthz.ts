import { prisma } from '../config/database';

/**
 * Guard used by `rtc:*` socket events — a user may only create transports
 * / produce / consume in a room they are currently joined to.
 * Phase 5 hardening: previously any authenticated socket could touch any
 * room's router. Now we require an active Participant row (leftAt IS NULL).
 */
export const isActiveRoomParticipant = async (roomId: string, userId: string): Promise<boolean> => {
  const row = await prisma.participant.findFirst({
    where: { roomId, userId, leftAt: null },
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
  const row = await prisma.participant.findFirst({
    where: { roomId, userId, leftAt: null, role: { in: ['HOST', 'MODERATOR', 'SPEAKER'] } },
    select: { id: true },
  });
  return row !== null;
};
