import type { Server, Socket } from 'socket.io';
import { usersService } from '../../modules/users/users.service';
import { getUserId } from '../socket.middleware';
import { logger } from '../../config/logger';
import { userChannel } from '../channels';
import { emitMapUserOffline } from '../realtime';
import { trackSocketDisconnectCleanup } from '../disconnect-cleanup';

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
export const registerPresenceHandlers = (io: Server, socket: Socket): void => {
  const me = (): string => getUserId(socket);

  const touch = (online: boolean): void => {
    trackSocketDisconnectCleanup(
      usersService.touchPresence(me(), online).catch(err => {
        logger.warn('presence touch failed', { err });
      }),
    );
  };

  touch(true); // mark online on connect

  socket.on('presence_update', () => touch(true));
  socket.on('disconnect', () => {
    const userId = me();
    trackSocketDisconnectCleanup(
      (async () => {
        // A user is offline only after their LAST live socket disappears. This
        // prevents a phone disconnect from hiding a still-connected tablet.
        const remaining = await io.in(userChannel(userId)).fetchSockets();
        const hasAnotherDevice = remaining.some(
          peer => peer.id !== socket.id && (peer.data as { userId?: string }).userId === userId,
        );
        if (hasAnotherDevice) return;
        await usersService.touchPresence(userId, false);
        await emitMapUserOffline(userId);
      })().catch(err => {
        logger.warn('presence disconnect cleanup failed', { err, userId });
      }),
    );
  });
};
