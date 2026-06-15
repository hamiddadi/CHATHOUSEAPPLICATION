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
// Public upcoming events a given user is hosting — shown on their profile.
roomsRouter.get('/users/:userId/upcoming', asyncHandler(roomsController.userUpcoming));
roomsRouter.get('/:id', asyncHandler(roomsController.get));
// Ending a live room is a business-state transition (close + release SFU),
// not a resource deletion. Prefer the explicit POST /:id/end action; the
// DELETE /:id alias is kept for backward compatibility with existing clients.
roomsRouter.post('/:id/end', asyncHandler(roomsController.end));
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
roomsRouter.patch('/:id/lock', asyncHandler(roomsController.setLock));
roomsRouter.post('/:id/mute-all', asyncHandler(roomsController.muteAll));

// Invitations & pings — bulk add to room or notify a friend to join.
roomsRouter.post('/:id/invite', asyncHandler(roomsController.invite));
// Ping a single friend to come join (public rooms only — enforced in service).
roomsRouter.post('/:id/ping/:userId', asyncHandler(roomsController.ping));

// Report a room — moderation queue, rate-limited 1 per (reporter, room) per 24h.
roomsRouter.post('/:id/report', asyncHandler(socialController.reportRoom));

// LiveKit token — fresh signed token bound to the caller's current role.
// Active-participant gate is enforced inside the controller. Returns
// 503 (LIVEKIT_001) when LIVEKIT_API_SECRET isn't configured.
roomsRouter.get('/:id/livekit-token', asyncHandler(roomsController.livekitToken));
