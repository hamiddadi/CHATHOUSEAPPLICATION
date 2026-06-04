import { prisma } from '../../../config/database';
import { redis } from '../../../config/redis';
import { extError } from '../../utils/ExtAppError';
import {
  emitSpeakInviteResponse,
  emitSpeakInviteSent,
  emitRolePromotedToModerator,
} from '../../realtime/aliases';
import { notificationsService } from '../../../modules/notifications/notifications.service';
import { logger } from '../../../config/logger';

/**
 * Speak-invite workflow with explicit accept/refuse (Module 5 / ROOM-INT-007,
 * 010, 011, 012).
 *
 * The legacy `setRole(SPEAKER)` path auto-accepts; this extension
 * introduces a two-step ceremony:
 *   1. Host posts `/api/ext/speak-invite/:roomId/invite/:userId` →
 *      creates a pending invite (Redis 5-min TTL) + sends notification
 *      + emits `speak_invite_sent` to the invitee
 *   2. Invitee posts `/api/ext/speak-invite/:roomId/respond {accepted}` →
 *      on accept, host's existing `setRole(SPEAKER)` is invoked; on refuse,
 *      invite is discarded. Both broadcast `speak_invite_response` to room.
 *
 * State stored in Redis: `ext:speakinv:<roomId>:<userId> = {hostId, sentAt}`.
 */

const INVITE_TTL_S = 5 * 60;
const inviteKey = (roomId: string, userId: string) => `ext:speakinv:${roomId}:${userId}`;

const isHostOrMod = async (roomId: string, userId: string): Promise<boolean> => {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { hostId: true },
  });
  if (!room) return false;
  if (room.hostId === userId) return true;
  const part = await prisma.participant.findUnique({
    where: { userId_roomId: { userId, roomId } },
    select: { role: true },
  });
  return part?.role === 'MODERATOR';
};

export const speakInviteService = {
  async invite(roomId: string, hostId: string, invitedUserId: string) {
    if (!(await isHostOrMod(roomId, hostId))) {
      throw extError('PAY_INVALID', 'Only host or moderator can invite');
    }
    const payload = JSON.stringify({ hostId, sentAt: new Date().toISOString() });
    await redis.setEx(inviteKey(roomId, invitedUserId), INVITE_TTL_S, payload);

    try {
      await notificationsService.create({
        userId: invitedUserId,
        actorId: hostId,
        type: 'SPEAKER_REQUEST',
        title: 'Invited to speak',
        body: 'You were invited to join the stage',
        data: { roomId, kind: 'speak_invite' },
        targetId: roomId,
        targetType: 'room',
      });
    } catch (err) {
      logger.warn('ext.speakInvite: notification failed', { err });
    }
    emitSpeakInviteSent(invitedUserId, { roomId, fromUserId: hostId });
    return { invited: true };
  },

  async respond(roomId: string, userId: string, accepted: boolean): Promise<{ accepted: boolean }> {
    const raw = await redis.get(inviteKey(roomId, userId));
    if (!raw) {
      throw extError('CLUB_REQ_NOT_FOUND', 'No active speak invite');
    }
    await redis.del(inviteKey(roomId, userId));

    if (accepted) {
      // Re-validate the inviter still holds host/mod rights. The invite key
      // can outlive a demotion/kick within the 5-min TTL; without this check
      // a stale invite would still promote the invitee to SPEAKER.
      let hostId: string | undefined;
      try {
        hostId = (JSON.parse(raw) as { hostId?: string }).hostId;
      } catch {
        hostId = undefined;
      }
      if (!hostId || !(await isHostOrMod(roomId, hostId))) {
        throw extError('CLUB_REQ_NOT_FOUND', 'Invite no longer valid');
      }
      // Mutate Participant.role to SPEAKER without touching legacy code
      const part = await prisma.participant.findUnique({
        where: { userId_roomId: { userId, roomId } },
      });
      if (!part) throw extError('CLUB_REQ_NOT_FOUND', 'Not in room');
      if (part.role !== 'SPEAKER' && part.role !== 'HOST') {
        await prisma.participant.update({
          where: { userId_roomId: { userId, roomId } },
          data: { role: 'SPEAKER' },
        });
      }
    }
    emitSpeakInviteResponse(roomId, { roomId, userId, accepted });
    return { accepted };
  },

  /**
   * Helper exposed to other extensions (e.g. an admin endpoint that wants
   * to promote a co-moderator atomically with broadcast).
   */
  async promoteToModerator(roomId: string, hostId: string, userId: string) {
    if (!(await isHostOrMod(roomId, hostId))) {
      throw extError('PAY_INVALID', 'Forbidden');
    }
    const part = await prisma.participant.findUnique({
      where: { userId_roomId: { userId, roomId } },
    });
    if (!part) throw extError('CLUB_REQ_NOT_FOUND', 'Not in room');
    if (part.role !== 'MODERATOR' && part.role !== 'HOST') {
      await prisma.participant.update({
        where: { userId_roomId: { userId, roomId } },
        data: { role: 'MODERATOR' },
      });
    }
    emitRolePromotedToModerator(roomId, userId);
    return { promoted: true };
  },
};
