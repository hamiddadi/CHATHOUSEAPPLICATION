import { prisma } from '../../../config/database';
import { redis } from '../../../config/redis';
import { extError } from '../../utils/ExtAppError';
import {
  emitSpeakInviteResponse,
  emitSpeakInviteSent,
  emitRolePromotedToModerator,
} from '../../realtime/aliases';
import { notificationsService } from '../../../modules/notifications/notifications.service';
import { roomsService } from '../../../modules/rooms/rooms.service';
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
    select: { hostId: true, endedAt: true },
  });
  if (!room) return false;
  // PART-03: an ended room has no privileged actors (mirror legacy
  // requireHostOrMod which rejects on room.endedAt).
  if (room.endedAt) return false;
  if (room.hostId === userId) return true;
  const part = await prisma.participant.findUnique({
    where: { userId_roomId: { userId, roomId } },
    select: { role: true, leftAt: true },
  });
  // PART-03: a moderator who has left the room is no longer a privileged
  // actor (mirror legacy requireHostOrMod which filters leftAt: null).
  if (!part || part.leftAt) return false;
  return part.role === 'MODERATOR';
};

export const speakInviteService = {
  async invite(roomId: string, hostId: string, invitedUserId: string) {
    if (!(await isHostOrMod(roomId, hostId))) {
      throw extError('SPEAK_001', 'Only host or moderator can invite');
    }
    // PART-09: only invite a user who is actually present in the room.
    // Otherwise the invite (notification + socket) fires for someone who is
    // not there, and respond() would later promote a non-participant.
    const invitee = await prisma.participant.findUnique({
      where: { userId_roomId: { userId: invitedUserId, roomId } },
      select: { leftAt: true },
    });
    if (!invitee || invitee.leftAt) {
      throw extError('SPEAK_002', 'User is not in the room');
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
      throw extError('SPEAK_002', 'No active speak invite');
    }

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
        // ANO-03 fix: do NOT delete the Redis key here — let it expire
        // naturally so the invite can be retried if the inviter regains
        // their role within the TTL window.
        throw extError('SPEAK_002', 'Invite no longer valid');
      }
      // PART-04/05, HAND-02/03/04: delegate the SPEAKER promotion to the
      // legacy setRole(SPEAKER) instead of writing Participant.role directly.
      // setRole enforces every guard the direct write skipped — room not
      // ended (ROOM_004), invitee still present (leftAt: null / USER_001),
      // maxSpeakers cap (ROOM_002, Serializable) — and fires the missing side
      // effects (RoomHandRaise purge, room:hand_lowered, room:role_changed,
      // HAND_ACCEPTED). The validated inviter acts as the host/mod caller.
      const part = await prisma.participant.findUnique({
        where: { userId_roomId: { userId, roomId } },
        select: { role: true, leftAt: true },
      });
      // HAND-03: a departed invitee (leftAt set, possibly with a stale SPEAKER
      // role) is not in the room — reject rather than report a phantom accept.
      if (!part || part.leftAt) throw extError('SPEAK_002', 'Not in room');
      // HAND-09: already on stage → no-op. Skip setRole's side effects AND skip
      // broadcasting a fresh promotion for someone who was already a speaker.
      if (part.role !== 'SPEAKER' && part.role !== 'HOST') {
        await roomsService.setRole(roomId, hostId, { userId, role: 'SPEAKER' });
      } else {
        await redis.del(inviteKey(roomId, userId));
        return { accepted };
      }
    }
    // ANO-03 fix: delete the Redis key AFTER the promotion/refusal succeeds,
    // not before validation. This prevents silently consuming an invite when
    // the inviter has been demoted.
    await redis.del(inviteKey(roomId, userId));
    emitSpeakInviteResponse(roomId, { roomId, userId, accepted });
    return { accepted };
  },

  /**
   * Helper exposed to other extensions (e.g. an admin endpoint that wants
   * to promote a co-moderator atomically with broadcast).
   */
  async promoteToModerator(roomId: string, hostId: string, userId: string) {
    // PART-02: promotion to MODERATOR is host-only (the legacy setRole reserves
    // MODERATOR for the host via ROOM_003). isHostOrMod would let a moderator
    // mint other moderators — an uncontrolled privilege chain. Restrict to the
    // strict host of a still-live room.
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { hostId: true, endedAt: true },
    });
    if (!room || room.endedAt || room.hostId !== hostId) {
      throw extError('SPEAK_001', 'Only the host can promote a moderator');
    }
    const part = await prisma.participant.findUnique({
      where: { userId_roomId: { userId, roomId } },
    });
    if (!part) throw extError('SPEAK_002', 'Not in room');
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
