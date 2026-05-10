import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { socialController } from '../social/social.controller';
import { roomsController } from './rooms.controller';

export const roomsRouter: Router = Router();

roomsRouter.use(requireAuth);

roomsRouter.get('/', asyncHandler(roomsController.list));
roomsRouter.post('/', asyncHandler(roomsController.create));
// /feed — personalised Hallway ranking. Must sit before the `/:id`
// catch-all so the literal path wins the route match.
roomsRouter.get('/feed', asyncHandler(roomsController.feed));
// /events/* lives under the rooms router to keep a single resource — an
// "event" is just a scheduled Room. Mounted above the :id routes so they
// don't get shadowed by the param matcher.
roomsRouter.get('/events/mine', asyncHandler(roomsController.myUpcoming));
// Hosting history — closed rooms the caller once hosted. Sits above
// `/:id` for the same literal-precedence reason as /feed and /events.
roomsRouter.get('/history/mine', asyncHandler(roomsController.myHistory));
roomsRouter.get('/:id', asyncHandler(roomsController.get));
roomsRouter.delete('/:id', asyncHandler(roomsController.end));
roomsRouter.post('/:id/join', asyncHandler(roomsController.join));
roomsRouter.post('/:id/leave', asyncHandler(roomsController.leave));
roomsRouter.patch('/:id/role', asyncHandler(roomsController.setRole));
roomsRouter.patch('/:id/mute', asyncHandler(roomsController.setMute));
roomsRouter.post('/:id/rsvp', asyncHandler(roomsController.rsvp));
roomsRouter.delete('/:id/rsvp', asyncHandler(roomsController.cancelRsvp));
roomsRouter.get('/:id/rsvps', asyncHandler(roomsController.listRsvps));

// Hand-raise queue.
roomsRouter.post('/:id/raise-hand', asyncHandler(roomsController.raiseHand));
roomsRouter.delete('/:id/raise-hand', asyncHandler(roomsController.lowerHand));
roomsRouter.get('/:id/hand-raises', asyncHandler(roomsController.listHandRaises));

// In-room text chat (distinct from DMs under /api/chat).
roomsRouter.post('/:id/messages', asyncHandler(roomsController.sendMessage));
roomsRouter.get('/:id/messages', asyncHandler(roomsController.listMessages));

// Ephemeral emoji reactions.
roomsRouter.post('/:id/reactions', asyncHandler(roomsController.reaction));

// Kick a participant (host or moderator only).
roomsRouter.post('/:id/kick', asyncHandler(roomsController.kick));

// Live room metadata edits (host/mod only)
roomsRouter.patch('/:id/title', asyncHandler(roomsController.updateTitle));
roomsRouter.patch('/:id/chat', asyncHandler(roomsController.toggleChat));
roomsRouter.post('/:id/mute-all', asyncHandler(roomsController.muteAll));

// Invitations & pings — bulk add to room or notify a friend to join.
roomsRouter.post('/:id/invite', asyncHandler(roomsController.invite));

// Report a room — moderation queue, rate-limited 1 per (reporter, room) per 24h.
roomsRouter.post('/:id/report', asyncHandler(socialController.reportRoom));

// Agora token — fresh signed token bound to the caller's current role.
// Active-participant gate is enforced inside the controller. Returns
// 503 (AGORA_001) when AGORA_PRIMARY_CERTIFICATE isn't configured.
roomsRouter.get('/:id/agora-token', asyncHandler(roomsController.agoraToken));
