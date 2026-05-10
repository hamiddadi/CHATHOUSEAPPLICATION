import type { Server, Socket } from 'socket.io';
import { usersService } from '../../modules/users/users.service';
import { logger } from '../../config/logger';

const MAPS_CHANNEL = 'maps:presence';

interface LocationPayload {
  latitude: number;
  longitude: number;
}
interface VisibilityPayload {
  isVisible: boolean;
}

/**
 * All sockets that open the map join the `maps:presence` channel so every
 * location update fans out to every viewer. Backend-driven filtering (Ghost
 * Mode) happens in usersService.getOnlineLocations on REST reads — for
 * real-time updates we still emit, but an isVisible=false user's update is
 * suppressed at source here (we simply don't broadcast it).
 */
export const registerMapsHandlers = (io: Server, socket: Socket): void => {
  const me = (): string => socket.data.userId as string;
  void socket.join(MAPS_CHANNEL);

  socket.on(
    'maps:update-location',
    async (payload: LocationPayload, ack?: (ok: boolean) => void) => {
      try {
        const updated = await usersService.setLocation(me(), payload);

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
    },
  );

  socket.on(
    'maps:toggle-visibility',
    async (payload: VisibilityPayload, ack?: (ok: boolean) => void) => {
      try {
        const result = await usersService.setVisibility(me(), { isVisible: payload.isVisible });
        if (!payload.isVisible) {
          // User entered Ghost Mode — drop them from every viewer's map.
          io.to(MAPS_CHANNEL).emit('maps:user-offline', { userId: me() });
        }
        ack?.(result.isVisible);
      } catch (err) {
        logger.warn('maps:toggle-visibility failed', { err });
        ack?.(false);
      }
    },
  );

  socket.on('disconnect', () => {
    socket.to(MAPS_CHANNEL).emit('maps:user-offline', { userId: me() });
  });
};
