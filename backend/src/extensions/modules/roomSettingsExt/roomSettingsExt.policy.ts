import { prisma } from '../../../config/database';
import { redis } from '../../../config/redis';

export type HandRaiseRestriction = 'everyone' | 'followers' | 'none';

const key = (roomId: string): string => `ext:roomset:${roomId}`;

export const readHandRaiseRestriction = async (roomId: string): Promise<HandRaiseRestriction> => {
  const raw = await redis.get(key(roomId));
  if (!raw) return 'everyone';
  try {
    const parsed = JSON.parse(raw) as { handRaiseRestriction?: unknown };
    return parsed.handRaiseRestriction === 'followers' || parsed.handRaiseRestriction === 'none'
      ? parsed.handRaiseRestriction
      : 'everyone';
  } catch {
    return 'everyone';
  }
};

export const canRaiseHandUnderRoomSettings = async (
  roomId: string,
  viewerId: string,
  hostId: string,
): Promise<boolean> => {
  const restriction = await readHandRaiseRestriction(roomId);
  if (restriction === 'none') return false;
  if (restriction === 'everyone') return true;
  const follow = await prisma.follow.findFirst({
    where: { followerId: viewerId, followingId: hostId, status: 'ACCEPTED' },
    select: { id: true },
  });
  return Boolean(follow);
};
