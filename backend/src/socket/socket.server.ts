import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { redis } from '../config/redis';
import {
  closeAllProducersForUser,
  closeTransportsForSocket,
  onProducerEvents,
} from '../webrtc/mediasoup.manager';
import { registerCaptionsRealtime } from '../extensions/realtime/captions.realtime';
import { roomsService } from '../modules/rooms/rooms.service';
import { setRealtimeServer } from './realtime';
import { socketAuth } from './socket.middleware';
import {
  attachSocketEventRateLimiter,
  MAX_SOCKET_PAYLOAD_BYTES,
  SocketEventRateLimiter,
} from './socket.rate-limit';
import { registerRoomHandlers } from './handlers/room.handler';
import { registerChatHandlers } from './handlers/chat.handler';
import { registerMapsHandlers } from './handlers/maps.handler';
import { registerRtcHandlers } from './handlers/rtc.handler';
import { registerHallwayHandlers } from './handlers/hallway.handler';
import { registerLatencyHandlers } from './handlers/latency.handler';
import { registerPresenceHandlers } from './handlers/presence.handler';
import { userChannel } from './channels';
import {
  drainSocketDisconnectCleanups as drainRoomDisconnectCleanups,
  enqueueSocketDisconnectCleanup,
  trackSocketDisconnectCleanup,
} from './disconnect-cleanup';
import { isSocketOriginAllowed } from './socket.origin';

// Backward-compatible name used by integration teardown and app shutdown.
export { drainSocketDisconnectCleanups as drainRoomDisconnectCleanups } from './disconnect-cleanup';

/**
 * Boot the Socket.IO layer on top of the existing HTTP server. The Redis
 * adapter (two duplicated clients for pub/sub) is what makes horizontal
 * scaling possible — any instance can emit, every connected client receives,
 * regardless of which node they are pinned to.
 */
export const createSocketServer = async (httpServer: HttpServer): Promise<Server> => {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, cb) => {
        const allowed = isSocketOriginAllowed(origin, {
          corsOrigins: env.CORS_ORIGINS,
          publicUrl: env.PUBLIC_URL,
          nodeEnv: env.NODE_ENV,
        });
        return allowed ? cb(null, true) : cb(new Error('CORS'));
      },
      credentials: true,
    },
    transports: ['websocket'],
    maxHttpBufferSize: MAX_SOCKET_PAYLOAD_BYTES,
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  // Two Redis clients: one for publishing, one for subscribing.
  const pub = redis.duplicate();
  const sub = redis.duplicate();
  pub.on('error', err => logger.error('socket pub error', { err }));
  sub.on('error', err => logger.error('socket sub error', { err }));
  await Promise.all([pub.connect(), sub.connect()]);
  io.adapter(createAdapter(pub, sub));

  // The Redis adapter does not own the duplicated clients passed to it.
  // Attach their lifecycle to the Socket.IO server so every caller of
  // `io.close()` (production shutdown and tests alike) also waits for queued
  // disconnect writes and releases both pub/sub sockets.
  const closeSocketIo = io.close.bind(io);
  let closePromise: Promise<void> | null = null;
  io.close = (callback?: (err?: Error) => void): Promise<void> => {
    if (!closePromise) {
      closePromise = closeSocketIo().then(async () => {
        await drainRoomDisconnectCleanups();
        // Socket.IO's Redis adapter queues its unsubscribe commands in
        // adapter.close() without awaiting their returned promises. `close()`
        // drains that queue before releasing the sockets; `destroy()` would
        // reject those in-flight unsubscribes as unhandled teardown errors.
        await Promise.all([
          pub.isOpen ? pub.close() : Promise.resolve(),
          sub.isOpen ? sub.close() : Promise.resolve(),
        ]);
      });
    }
    if (callback) {
      void closePromise.then(
        () => callback(),
        err => callback(err instanceof Error ? err : new Error(String(err))),
      );
    }
    return closePromise;
  };

  io.use(socketAuth);
  const eventRateLimiter = new SocketEventRateLimiter();

  // Publish the live Server reference so the HTTP layer can fan events
  // into the socket tier (hallway broadcasts, etc.) without importing
  // socket.server directly.
  setRealtimeServer(io);

  // Bridge mediasoup events to per-room socket.io broadcasts. The manager
  // fires these whenever a producer is added or closed; we fan out to the
  // `room:<id>` channel (already joined by every participant of that room
  // in the room.handler layer) so every peer except the producer sees it.
  onProducerEvents({
    onAdded: info => {
      io.to(`room:${info.roomId}`).emit('rtc:new-producer', {
        producerId: info.producerId,
        userId: info.userId,
        kind: info.kind,
      });
    },
    onClosed: info => {
      io.to(`room:${info.roomId}`).emit('rtc:producer-closed', {
        producerId: info.producerId,
        userId: info.userId,
      });
    },
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as string;
    logger.info(`socket connected user=${userId} id=${socket.id}`);
    attachSocketEventRateLimiter(socket, eventRateLimiter);
    let disconnectingRoomChannels: string[] = [];
    // Account-level fan-out/revocation must not depend on any feature handler
    // being registered. Joining twice is idempotent (chat.handler also joins
    // this channel for backward compatibility).
    void socket.join(userChannel(userId));

    registerRoomHandlers(io, socket);
    registerChatHandlers(io, socket);
    registerMapsHandlers(io, socket);
    registerRtcHandlers(socket);
    registerHallwayHandlers(io, socket);
    registerLatencyHandlers(socket);
    registerPresenceHandlers(io, socket);
    // Extensions: on-device live-captions relay (caption:publish → room:caption).
    registerCaptionsRealtime(io, socket);

    socket.on('disconnecting', () => {
      // Capture while socket.rooms is populated, then process after this
      // socket has actually left the adapter. Checking during `disconnecting`
      // let two devices see each other and both skip cleanup.
      disconnectingRoomChannels = [...socket.rooms].filter(r => r.startsWith('room:'));
    });

    socket.on('disconnect', reason => {
      // RTP transports are scoped to one concrete socket/device. Releasing
      // them here does not interrupt another device for the same account,
      // which owns separate transports.
      const closedTransports = closeTransportsForSocket(socket.id);
      if (closedTransports > 0) {
        logger.info(
          `closed ${closedTransports} RTC transport(s) for socket=${socket.id} on disconnect`,
        );
      }

      for (const channel of disconnectingRoomChannels) {
        const roomId = channel.slice('room:'.length);
        enqueueSocketDisconnectCleanup(`${roomId}:${userId}`, async () => {
          try {
            const peers = await io.in(channel).fetchSockets();
            const userHasAnotherSocket = peers.some(
              s => (s.data as { userId?: string }).userId === userId,
            );
            if (userHasAnotherSocket) return;
            await roomsService.leave(roomId, userId);
          } catch (err) {
            logger.warn('socket disconnect room cleanup failed', { err, roomId, userId });
          }
        });
      }

      // Only the last device may close account-level producers. Previously one
      // phone disconnecting also cut audio produced by a still-live tablet.
      trackSocketDisconnectCleanup(
        (async () => {
          const remaining = await io.in(userChannel(userId)).fetchSockets();
          const hasAnotherDevice = remaining.some(
            peer => (peer.data as { userId?: string }).userId === userId,
          );
          if (hasAnotherDevice) return;
          const closed = closeAllProducersForUser(userId);
          if (closed > 0) {
            logger.info(`closed ${closed} producer(s) for user=${userId} on last disconnect`);
          }
        })().catch(err =>
          logger.warn('socket producer disconnect cleanup failed', { err, userId }),
        ),
      );
      logger.info(`socket disconnected user=${userId} id=${socket.id} reason=${reason}`);
    });
  });

  return io;
};
