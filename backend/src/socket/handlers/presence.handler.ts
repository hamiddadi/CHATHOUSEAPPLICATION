import type { Socket } from 'socket.io';
import { usersService } from '../../modules/users/users.service';
import { getUserId } from '../socket.middleware';
import { logger } from '../../config/logger';

/**
 * Presence lifecycle over the socket. The FE (useExtPresenceHeartbeat) emits
 * `presence_update` every ~30s while foregrounded; we also flip isOnline on
 * connect and disconnect. This keeps User.isOnline / lastSeenAt fresh so the
 * discovery surfaces (explore featured users, available-people strip, map)
 * reflect reality. Best-effort: a failed write never breaks the socket.
 *
 * Multi-tab note: a disconnect marks the user offline, but any other live tab
 * re-marks online within one heartbeat; discovery keys off lastSeenAt (durable)
 * so the brief window is harmless.
 */
export const registerPresenceHandlers = (socket: Socket): void => {
  const me = (): string => getUserId(socket);

  const touch = (online: boolean): void => {
    void usersService.touchPresence(me(), online).catch(err => {
      logger.warn('presence touch failed', { err });
    });
  };

  touch(true); // mark online on connect

  socket.on('presence_update', () => touch(true));
  socket.on('disconnect', () => touch(false));
};
