import { prisma } from '../../../config/database';
import { roomsService } from '../../../modules/rooms/rooms.service';
import { extError } from '../../utils/ExtAppError';
import { writeJson } from '../../utils/redisJson';
import {
  canRaiseHandUnderRoomSettings,
  readHandRaiseRestriction,
  type HandRaiseRestriction,
} from './roomSettingsExt.policy';

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

export type { HandRaiseRestriction } from './roomSettingsExt.policy';

export interface ExtRoomSettings {
  handRaiseRestriction: HandRaiseRestriction;
  coHostIds: string[];
}

const requireHostOrMod = async (roomId: string, userId: string): Promise<void> => {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { hostId: true, endedAt: true, isLive: true },
  });
  if (!room) throw extError('CLUB_REQ_NOT_FOUND', 'Room not found');
  if (room.endedAt || !room.isLive) throw extError('CLUB_REQ_NOT_FOUND', 'Room not found');
  if (room.hostId === userId) return;
  const part = await prisma.participant.findUnique({
    where: { userId_roomId: { userId, roomId } },
    select: { role: true, leftAt: true },
  });
  if (!part || part.leftAt || part.role !== 'MODERATOR') {
    throw extError('PAY_INVALID', 'Not allowed');
  }
};

export const roomSettingsExtService = {
  async get(roomId: string): Promise<ExtRoomSettings> {
    const [handRaiseRestriction, moderators] = await Promise.all([
      readHandRaiseRestriction(roomId),
      prisma.participant.findMany({
        where: { roomId, leftAt: null, role: 'MODERATOR', user: { deletedAt: null } },
        select: { userId: true },
      }),
    ]);
    return {
      handRaiseRestriction,
      // Participant.role is authoritative. Returning a Redis-maintained copy
      // drifted after kicks, leaves and role changes.
      coHostIds: moderators.map(m => m.userId),
    };
  },

  async getForParticipant(roomId: string, callerId: string): Promise<ExtRoomSettings> {
    const room = await prisma.room.findFirst({
      where: {
        id: roomId,
        endedAt: null,
        isLive: true,
        participants: { some: { userId: callerId, leftAt: null } },
      },
      select: { id: true },
    });
    if (!room) throw extError('CLUB_REQ_NOT_FOUND', 'Room not found');
    return this.get(roomId);
  },

  async setHandRaise(
    roomId: string,
    callerId: string,
    restriction: HandRaiseRestriction,
  ): Promise<ExtRoomSettings> {
    await requireHostOrMod(roomId, callerId);
    // Only the preference belongs in Redis; co-hosts are derived from the
    // authoritative Participant rows on read.
    await writeJson(key(roomId), { handRaiseRestriction: restriction }, TTL_S);
    return this.get(roomId);
  },

  async addCoHost(roomId: string, callerId: string, coHostId: string): Promise<ExtRoomSettings> {
    // Core setRole enforces a live room, active target and host-only moderator
    // promotion, and emits the canonical realtime role event.
    await roomsService.setRole(roomId, callerId, {
      userId: coHostId,
      role: 'MODERATOR',
    });
    return this.get(roomId);
  },

  async removeCoHost(roomId: string, callerId: string, coHostId: string): Promise<ExtRoomSettings> {
    const room = await prisma.room.findFirst({
      where: { id: roomId, hostId: callerId, endedAt: null, isLive: true },
      select: { id: true },
    });
    if (!room) throw extError('PAY_INVALID', 'Only the host can remove a co-host');
    await roomsService.setRole(roomId, callerId, {
      userId: coHostId,
      role: 'LISTENER',
    });
    return this.get(roomId);
  },

  /**
   * Convenience helper for the hand-raise flow — returns whether a given
   * listener may raise their hand under the current restriction.
   */
  async canRaiseHand(roomId: string, viewerId: string, hostId: string): Promise<boolean> {
    return canRaiseHandUnderRoomSettings(roomId, viewerId, hostId);
  },
};
