/**
 * Extended server entry point — wraps the existing createApp() without
 * touching any existing file.
 *
 * Usage:  pnpm dev:ext   (or)   node dist/extensions/server.js
 */
import http from 'node:http';
import { createApp } from '../app';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { connectRedis, disconnectRedis } from '../config/redis';
import { disconnectDatabase } from '../config/database';
import { createSocketServer } from '../socket/socket.server';
import { initMediasoup, shutdownMediasoup } from '../webrtc/mediasoup.manager';
import { startReminderWorker, shutdownReminders } from '../queues/eventReminders';
import { startLocationPurgeWorker, shutdownLocationPurge } from '../queues/locationPurge';
import { ensureSearchIndexes } from '../config/searchIndexes';
import { mountExtensions } from './mount';
import { setRealtimeAliasServer } from './realtime/aliases';

const startExtended = async (): Promise<void> => {
  await connectRedis();
  await ensureSearchIndexes();
  await initMediasoup().catch((err: unknown) => {
    logger.warn('mediasoup init failed', { err: err instanceof Error ? err.message : err });
  });
  startReminderWorker();
  await startLocationPurgeWorker();

  const app = createApp();
  mountExtensions(app);

  const server = http.createServer(app);
  const io = await createSocketServer(server);
  // Bind the alias emitter so extension code can publish events under the
  // Clubhouse-spec names (e.g. `room_title_updated`) without touching the
  // legacy realtime module.
  setRealtimeAliasServer(io);
  void io;

  server.listen(env.PORT, env.HOST, () => {
    logger.info(
      `Chathouse API (extended) listening on http://${env.HOST}:${env.PORT} (${env.NODE_ENV})`,
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received — graceful shutdown`);
    server.close(async () => {
      try {
        await shutdownMediasoup();
        await shutdownReminders();
        await shutdownLocationPurge();
        await disconnectDatabase();
        await disconnectRedis();
        logger.info('extended server stopped cleanly');
        process.exit(0);
      } catch (err) {
        logger.error('shutdown error', { err });
        process.exit(1);
      }
    });
    setTimeout(() => {
      logger.error('forced shutdown after 10s');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', err => logger.error('unhandledRejection', { err }));
  process.on('uncaughtException', err => {
    logger.error('uncaughtException', { err });
    void shutdown('uncaughtException');
  });
};

if (require.main === module) {
  void startExtended();
}
