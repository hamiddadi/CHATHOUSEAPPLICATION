import type { Server, Socket } from 'socket.io';
import { usersService } from '../../modules/users/users.service';
import { locationSchema, visibilitySchema } from '../../modules/users/users.schema';
import { logger } from '../../config/logger';
import { getUserId } from '../socket.middleware';

const MAPS_CHANNEL = 'maps:presence';

/**
 * All sockets that open the map join the `maps:presence` channel so every
 * location update fans out to every viewer. Backend-driven filtering (Ghost
 * Mode) happens in usersService.getOnlineLocations on REST reads — for
 * real-time updates we still emit, but an isVisible=false user's update is
 * suppressed at source here (we simply don't broadcast it).
 */
export const registerMapsHandlers = (io: Server, socket: Socket): void => {
  const me = (): string => getUserId(socket);
  void socket.join(MAPS_CHANNEL);

  socket.on('maps:update-location', async (payload: unknown, ack?: (ok: boolean) => void) => {
    try {
      // Validate at the socket boundary too — the REST locationSchema was
      // never applied here, so raw/out-of-range/non-numeric coords could be
      // written straight to Float columns and fanned out to every viewer.
      const loc = locationSchema.parse(payload);
      const updated = await usersService.setLocation(me(), loc);

      // Broadcast to everyone watching the map, minus this socket.
      socket.to(MAPS_CHANNEL).emit('maps:user-moved', {
        userId: me(),
        latitude: updated.latitude,
        longitude: updated.longitude,
      });
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
      if (!isVisible) {
        // User entered Ghost Mode — drop them from every viewer's map.
        io.to(MAPS_CHANNEL).emit('maps:user-offline', { userId: me() });
      }
      ack?.(result.isVisible);
    } catch (err) {
      logger.warn('maps:toggle-visibility failed', { err });
      ack?.(false);
    }
  });

  socket.on('disconnect', () => {
    socket.to(MAPS_CHANNEL).emit('maps:user-offline', { userId: me() });
  });
};
