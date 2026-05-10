import type { Server, Socket } from 'socket.io';

/**
 * Hallway handler — every authenticated client auto-joins the global
 * "hallway" room on connect so they receive feed-wide events:
 *   - hallway:room_created   (new live room available to discover)
 *   - hallway:room_closed    (a room just ended — drop it from the feed)
 *   - hallway:room_updated   (participant-count delta, title change, etc.)
 *
 * Emission is done from `rooms.service` (service-side, via `emitHallway*`)
 * so the broadcast fires whether the mutation came in via REST, socket,
 * or a background worker (e.g. BullMQ reminder flipping a scheduled room
 * to live).
 */
export const HALLWAY_ROOM = 'hallway:global';

export const registerHallwayHandlers = (_io: Server, socket: Socket): void => {
  void socket.join(HALLWAY_ROOM);
  // No events to subscribe to — clients only listen. Kept as a function
  // so symmetry with other handlers stays clean.
};
