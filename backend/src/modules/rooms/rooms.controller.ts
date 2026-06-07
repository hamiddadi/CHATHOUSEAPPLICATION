import type { Request, Response } from 'express';
import { sendOk } from '../../utils/response';
import { AppError } from '../../middlewares/error.middleware';
import { prisma } from '../../config/database';
import {
  closeRoom as closeSfuRoom,
  closeProducersForUserInRoom,
} from '../../webrtc/mediasoup.manager';
import { authedUserId as requireUserId } from '../../utils/authedUserId';
import { livekitService, type LivekitParticipantRole } from './livekit.service';
import {
  createRoomSchema,
  inviteToRoomSchema,
  kickSchema,
  listRoomsSchema,
  muteAllSchema,
  muteSchema,
  sendReactionSchema,
  sendRoomMessageSchema,
  toggleRoomChatSchema,
  updateRoleSchema,
  updateRoomTitleSchema,
} from './rooms.schema';
import { roomsService } from './rooms.service';

const paramId = (req: Request, key: string): string => {
  const raw = req.params[key];
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id) throw new AppError('ROOM_001');
  return id;
};

// Shared list pagination guard for the limit query param: parses to an int,
// clamps to [1, max] and falls back to `def` for missing/non-numeric input.
const parseLimit = (raw: unknown, def = 20, max = 50): number => {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? Math.max(1, Math.min(max, n)) : def;
};

export const roomsController = {
  async list(req: Request, res: Response) {
    const input = listRoomsSchema.parse(req.query);
    const rows = await roomsService.list(input);
    sendOk(res, rows);
  },

  async create(req: Request, res: Response) {
    const input = createRoomSchema.parse(req.body);
    const room = await roomsService.create(requireUserId(req), input);
    sendOk(res, room, 201);
  },

  async get(req: Request, res: Response) {
    // Pass the authenticated viewer so the service can annotate each
    // LISTENER with `followedByViewer`. The rooms router mounts every route
    // behind requireAuth, so req.userId is populated; it stays optional in
    // the service (undefined → flag false everywhere) for callers without
    // an authenticated viewer.
    const room = await roomsService.get(paramId(req, 'id'), req.userId);
    sendOk(res, room);
  },

  async join(req: Request, res: Response) {
    const room = await roomsService.join(paramId(req, 'id'), requireUserId(req));
    sendOk(res, room);
  },

  async leave(req: Request, res: Response) {
    const result = await roomsService.leave(paramId(req, 'id'), requireUserId(req));
    sendOk(res, result);
  },

  async end(req: Request, res: Response) {
    const roomId = paramId(req, 'id');
    const result = await roomsService.end(roomId, requireUserId(req));
    // Release SFU state too so a subsequent /rooms/:id/join on a reused id
    // doesn't inherit the old router.
    await closeSfuRoom(roomId);
    sendOk(res, result);
  },

  async setRole(req: Request, res: Response) {
    const input = updateRoleSchema.parse(req.body);
    const result = await roomsService.setRole(paramId(req, 'id'), requireUserId(req), input);
    sendOk(res, result);
  },

  async setMute(req: Request, res: Response) {
    const input = muteSchema.parse(req.body);
    const result = await roomsService.setMute(paramId(req, 'id'), requireUserId(req), input);
    sendOk(res, result);
  },

  async rsvp(req: Request, res: Response) {
    const result = await roomsService.rsvp(paramId(req, 'id'), requireUserId(req));
    sendOk(res, result);
  },

  async cancelRsvp(req: Request, res: Response) {
    const result = await roomsService.cancelRsvp(paramId(req, 'id'), requireUserId(req));
    sendOk(res, result);
  },

  async listRsvps(req: Request, res: Response) {
    const roomId = paramId(req, 'id');
    const userId = requireUserId(req);
    // viewerId lets the service hide the attendee list of private rooms from
    // non-members (see roomsService.listRsvps).
    const rows = await roomsService.listRsvps(roomId, userId);
    sendOk(res, rows);
  },

  async myUpcoming(req: Request, res: Response) {
    const rows = await roomsService.myUpcomingEvents(requireUserId(req));
    sendOk(res, rows);
  },

  async myHistory(req: Request, res: Response) {
    const limit = parseLimit(req.query['limit']);
    const rows = await roomsService.myRoomHistory(requireUserId(req), limit);
    sendOk(res, rows);
  },

  async feed(req: Request, res: Response) {
    const limit = parseLimit(req.query['limit']);
    // Optional topic / following filter — passed through to the service so
    // the scoring pool is narrowed before ranking. `topic=tech` matches
    // both Room.topic (single) and Room.topics[] (array).
    const topicQ = req.query['topic'];
    const topic =
      typeof topicQ === 'string' && topicQ.length > 0 ? topicQ.toLowerCase() : undefined;
    const followingQ = req.query['following'];
    const following = followingQ === 'true' || followingQ === '1';
    // `clubs=true` restricts the feed to rooms attached to a club.
    const clubsQ = req.query['clubs'];
    const clubs = clubsQ === 'true' || clubsQ === '1';
    const rows = await roomsService.feed(requireUserId(req), limit, undefined, {
      topic,
      following,
      clubs,
    });
    sendOk(res, rows);
  },

  async raiseHand(req: Request, res: Response) {
    const result = await roomsService.raiseHand(paramId(req, 'id'), requireUserId(req));
    sendOk(res, result);
  },

  async lowerHand(req: Request, res: Response) {
    const result = await roomsService.lowerHand(paramId(req, 'id'), requireUserId(req));
    sendOk(res, result);
  },

  async listHandRaises(req: Request, res: Response) {
    const rows = await roomsService.listHandRaises(paramId(req, 'id'), requireUserId(req));
    sendOk(res, rows);
  },

  // Host/moderator dismisses another user's raised hand.
  async dismissHand(req: Request, res: Response) {
    const result = await roomsService.dismissHand(
      paramId(req, 'id'),
      requireUserId(req),
      paramId(req, 'userId'),
    );
    sendOk(res, result);
  },

  async sendMessage(req: Request, res: Response) {
    const input = sendRoomMessageSchema.parse(req.body);
    const msg = await roomsService.sendRoomMessage(paramId(req, 'id'), requireUserId(req), input);
    sendOk(res, msg, 201);
  },

  async listMessages(req: Request, res: Response) {
    const rows = await roomsService.listRoomMessages(paramId(req, 'id'), requireUserId(req));
    sendOk(res, rows);
  },

  async reaction(req: Request, res: Response) {
    const input = sendReactionSchema.parse(req.body);
    const r = await roomsService.sendReaction(paramId(req, 'id'), requireUserId(req), input);
    sendOk(res, r, 201);
  },

  async kick(req: Request, res: Response) {
    const input = kickSchema.parse(req.body);
    const roomId = paramId(req, 'id');
    const result = await roomsService.kick(roomId, requireUserId(req), input.userId, {
      banMinutes: input.banMinutes,
      reason: input.reason,
    });
    // Tear down the kicked user's SFU producers so peers stop consuming their
    // audio immediately — the socket `room:user_kicked` broadcast (emitted by
    // roomsService.kick) already pops the client out of the room. The Producer
    // `close` handler fans out `rtc:producer-closed` so consumers clean up.
    // Idempotent: a no-op (returns 0) if RTC wasn't in use for this user.
    closeProducersForUserInRoom(roomId, input.userId);
    sendOk(res, result);
  },

  async updateTitle(req: Request, res: Response) {
    const input = updateRoomTitleSchema.parse(req.body);
    const result = await roomsService.updateTitle(paramId(req, 'id'), requireUserId(req), input);
    sendOk(res, result);
  },

  async toggleChat(req: Request, res: Response) {
    const input = toggleRoomChatSchema.parse(req.body);
    const result = await roomsService.toggleChat(paramId(req, 'id'), requireUserId(req), input);
    sendOk(res, result);
  },

  async muteAll(req: Request, res: Response) {
    const input = muteAllSchema.parse(req.body ?? {});
    const result = await roomsService.muteAll(paramId(req, 'id'), requireUserId(req), input);
    sendOk(res, result);
  },

  async invite(req: Request, res: Response) {
    const input = inviteToRoomSchema.parse(req.body);
    const result = await roomsService.invite(paramId(req, 'id'), requireUserId(req), input);
    sendOk(res, result);
  },

  async ping(req: Request, res: Response) {
    // roomId + targetUserId both come from the path so the endpoint is
    // consistent with the rest of the file (no mixing body + params).
    // Wired as POST /:id/ping/:userId in rooms.router.ts.
    const result = await roomsService.pingUser(
      paramId(req, 'id'),
      requireUserId(req),
      paramId(req, 'userId'),
    );
    sendOk(res, result);
  },

  /**
   * Issue a LiveKit token for the caller's current role in the room. The
   * token is bound to (room = roomId, identity = userId, canPublish).
   * Caller MUST be an active participant — listeners get canPublish=false,
   * host/mod/speaker get canPublish=true. The client refetches this to
   * renew before the token expires.
   */
  async livekitToken(req: Request, res: Response) {
    const userId = requireUserId(req);
    const roomId = paramId(req, 'id');

    const participant = await prisma.participant.findUnique({
      where: { userId_roomId: { userId, roomId } },
      select: { role: true, leftAt: true },
    });
    if (!participant || participant.leftAt) throw new AppError('ROOM_005');

    const result = await livekitService.issueRoomToken({
      roomId,
      userId,
      role: participant.role as LivekitParticipantRole,
    });
    sendOk(res, result);
  },
};
