import type { Server, Socket } from 'socket.io';
import { usersService } from '../../modules/users/users.service';
import { locationSchema, visibilitySchema } from '../../modules/users/users.schema';
import { logger } from '../../config/logger';
import { getUserId } from '../socket.middleware';
import { MAPS_CHANNEL } from '../channels';

/**
 * All sockets that open the map join the `maps:presence` channel so every
 * location update fans out to every viewer. Backend-driven filtering (Ghost
 * Mode) happens in usersService.getOnlineLocations on REST reads — for
 * real-time updates we still emit, but an isVisible=false user's update is
 * suppressed at source here (we simply don't broadcast it).
 */
export const registerMapsHandlers = (_io: Server, socket: Socket): void => {
  const me = (): string => getUserId(socket);

  socket.on('maps:subscribe', async (ack?: (ok: boolean) => void) => {
    try {
      await socket.join(MAPS_CHANNEL);
      ack?.(true);
    } catch (err) {
      logger.warn('maps:subscribe failed', { err, userId: me() });
      ack?.(false);
    }
  });

  socket.on('maps:unsubscribe', () => {
    void socket.leave(MAPS_CHANNEL);
  });

  socket.on('maps:update-location', async (payload: unknown, ack?: (ok: boolean) => void) => {
    try {
      // Validate at the socket boundary too — the REST locationSchema was
      // never applied here, so raw/out-of-range/non-numeric coords could be
      // written straight to Float columns and fanned out to every viewer.
      const loc = locationSchema.parse(payload);
      await usersService.setLocation(me(), loc);
      ack?.(true);
    } catch (err) {
      logger.warn('maps:update-location failed', { err });
      ack?.(false);
    }
  });

  socket.on('maps:toggle-visibility', async (payload: unknown, ack?: (ok: boolean) => void) => {
    try {
      const { isVisible } = visibilitySchema.parse(payload);
      const result = await usersService.setVisibility(me(), { isVisible });
      ack?.(result.isVisible);
    } catch (err) {
      logger.warn('maps:toggle-visibility failed', { err });
      ack?.(false);
    }
  });

  // Last-device disconnect handling is centralised in presence.handler. A map
  // listener here used to remove a user's pin when only one of several devices
  // disconnected.
};
