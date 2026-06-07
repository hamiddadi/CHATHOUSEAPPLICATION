import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { redis } from '../config/redis';
import { closeAllProducersForUser, onProducerEvents } from '../webrtc/mediasoup.manager';
import { socketAuth } from './socket.middleware';
import { registerRoomHandlers } from './handlers/room.handler';
import { registerChatHandlers } from './handlers/chat.handler';
import { registerMapsHandlers } from './handlers/maps.handler';
import { registerRtcHandlers } from './handlers/rtc.handler';
import { registerHallwayHandlers } from './handlers/hallway.handler';
import { registerLatencyHandlers } from './handlers/latency.handler';
import { setRealtimeServer } from './realtime';

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
        if (!origin) return cb(null, true);
        return env.CORS_ORIGINS.includes(origin) ? cb(null, true) : cb(new Error('CORS'));
      },
      credentials: true,
    },
    transports: ['polling', 'websocket'],
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

  io.use(socketAuth);

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

    registerRoomHandlers(io, socket);
    registerChatHandlers(io, socket);
    registerMapsHandlers(io, socket);
    registerRtcHandlers(socket);
    registerHallwayHandlers(io, socket);
    registerLatencyHandlers(socket);

    socket.on('disconnect', reason => {
      // A user can have multiple concurrent sockets (two tabs). If this is
      // their last socket we can still eagerly close producers — mediasoup
      // is tolerant: closing an already-consumed-by-nobody producer is cheap.
      const closed = closeAllProducersForUser(userId);
      if (closed > 0) logger.info(`closed ${closed} producer(s) for user=${userId} on disconnect`);
      logger.info(`socket disconnected user=${userId} id=${socket.id} reason=${reason}`);
    });
  });

  return io;
};
