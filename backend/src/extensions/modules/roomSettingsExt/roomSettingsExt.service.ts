import { redis } from '../../../config/redis';
import { prisma } from '../../../config/database';
import { extError } from '../../utils/ExtAppError';

/**
 * Per-room extended settings (Module 5.5 / ROOM-INT-009 — restrict hand
 * raise to followers).
 *
 * The legacy `Room` schema is intentionally lean; this extension stores
 * one tiny JSON blob per room in Redis covering toggles that didn't
 * warrant a migration :
 *   - handRaiseRestriction : 'everyone' | 'followers' | 'none'
 *   - co-host list (denormalized for fast read; the canonical source is
 *     the Participant.role column)
 *
 * Authorization : host or moderator can write; anyone in the room can
 * read.
 */

const TTL_S = 24 * 3600;
const key = (roomId: string) => `ext:roomset:${roomId}`;

export type HandRaiseRestriction = 'everyone' | 'followers' | 'none';

export interface ExtRoomSettings {
  handRaiseRestriction: HandRaiseRestriction;
  coHostIds: string[];
}

const DEFAULTS: ExtRoomSettings = {
  handRaiseRestriction: 'everyone',
  coHostIds: [],
};

const requireHostOrMod = async (roomId: string, userId: string): Promise<void> => {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { hostId: true },
  });
  if (!room) throw extError('CLUB_REQ_NOT_FOUND', 'Room not found');
  if (room.hostId === userId) return;
  const part = await prisma.participant.findUnique({
    where: { userId_roomId: { userId, roomId } },
    select: { role: true },
  });
  if (part?.role !== 'MODERATOR') throw extError('PAY_INVALID', 'Not allowed');
};

export const roomSettingsExtService = {
  async get(roomId: string): Promise<ExtRoomSettings> {
    const raw = await redis.get(key(roomId));
    if (!raw) return DEFAULTS;
    try {
      const parsed = JSON.parse(raw) as Partial<ExtRoomSettings>;
      return {
        handRaiseRestriction:
          parsed.handRaiseRestriction === 'followers' || parsed.handRaiseRestriction === 'none'
            ? parsed.handRaiseRestriction
            : 'everyone',
        coHostIds: Array.isArray(parsed.coHostIds) ? parsed.coHostIds : [],
      };
    } catch {
      return DEFAULTS;
    }
  },

  async setHandRaise(
    roomId: string,
    callerId: string,
    restriction: HandRaiseRestriction,
  ): Promise<ExtRoomSettings> {
    await requireHostOrMod(roomId, callerId);
    const current = await this.get(roomId);
    const next: ExtRoomSettings = { ...current, handRaiseRestriction: restriction };
    await redis.setEx(key(roomId), TTL_S, JSON.stringify(next));
    return next;
  },

  async addCoHost(roomId: string, callerId: string, coHostId: string): Promise<ExtRoomSettings> {
    await requireHostOrMod(roomId, callerId);
    const current = await this.get(roomId);
    if (current.coHostIds.includes(coHostId)) return current;
    const next: ExtRoomSettings = {
      ...current,
      coHostIds: [...current.coHostIds, coHostId],
    };
    await redis.setEx(key(roomId), TTL_S, JSON.stringify(next));
    return next;
  },

  async removeCoHost(roomId: string, callerId: string, coHostId: string): Promise<ExtRoomSettings> {
    await requireHostOrMod(roomId, callerId);
    const current = await this.get(roomId);
    const next: ExtRoomSettings = {
      ...current,
      coHostIds: current.coHostIds.filter(id => id !== coHostId),
    };
    await redis.setEx(key(roomId), TTL_S, JSON.stringify(next));
    return next;
  },

  /**
   * Convenience helper for the hand-raise flow — returns whether a given
   * listener may raise their hand under the current restriction.
   */
  async canRaiseHand(roomId: string, viewerId: string, hostId: string): Promise<boolean> {
    const settings = await this.get(roomId);
    if (settings.handRaiseRestriction === 'none') return false;
    if (settings.handRaiseRestriction === 'everyone') return true;
    // 'followers' — viewer must follow the host
    const follow = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: viewerId, followingId: hostId } },
      select: { id: true },
    });
    return Boolean(follow);
  },
};
