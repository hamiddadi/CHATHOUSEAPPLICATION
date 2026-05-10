import http from 'node:http';
import express, { json as expressJson, urlencoded as expressUrlencoded } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import { env } from './config/env';
import { logger } from './config/logger';
import { connectRedis, disconnectRedis } from './config/redis';
import { disconnectDatabase } from './config/database';
import { globalLimiter } from './middlewares/rateLimit.middleware';
import { errorMiddleware, notFoundHandler } from './middlewares/error.middleware';
import { healthRouter } from './routes/health';
import { docsRouter } from './routes/docs';
import { authRouter } from './modules/auth/auth.router';
import { usersRouter } from './modules/users/users.router';
import { followRouter } from './modules/follow/follow.router';
import { roomsRouter } from './modules/rooms/rooms.router';
import { chatRouter } from './modules/chat/chat.router';
import { mapsRouter } from './modules/maps/maps.router';
import { notificationsRouter } from './modules/notifications/notifications.router';
import { clubsRouter } from './modules/clubs/clubs.router';
import { searchRouter } from './modules/search/search.router';
import { exploreRouter } from './modules/explore/explore.router';
import { pushRouter } from './modules/push/push.router';
import { adminRouter } from './modules/admin/admin.router';
import { createSocketServer } from './socket/socket.server';
import { initMediasoup, shutdownMediasoup } from './webrtc/mediasoup.manager';
import { startReminderWorker, shutdownReminders } from './queues/eventReminders';
import { ensureSearchIndexes } from './config/searchIndexes';

export const createApp = (): express.Express => {
  const app = express();

  app.set('trust proxy', 1);

  // Body parsers — cap at 1 MB; avatar uploads go through /upload (phase 2)
  app.use(expressJson({ limit: '1mb' }));
  app.use(expressUrlencoded({ extended: true, limit: '1mb' }));

  // Security headers. contentSecurityPolicy is disabled for the API itself
  // (no HTML served); re-enable if you ever mount a web UI on the same host.
  app.use(
    helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }),
  );

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true); // server-to-server / mobile RN
        return env.CORS_ORIGINS.includes(origin) ? cb(null, true) : cb(new Error('CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    }),
  );

  app.use(compression());
  app.use(
    morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev', {
      stream: { write: (line: string) => logger.info(line.trim()) },
    }),
  );

  // Health is unauthenticated and unratelimited (Kubernetes/ECS probes).
  app.use(healthRouter);

  // OpenAPI/Swagger UI — also unauthenticated + unratelimited so consumers
  // can browse the contract. Mount BEFORE the /api globalLimiter.
  app.use('/api/docs', docsRouter);

  // Everything else is under /api and globally rate-limited.
  app.use('/api', globalLimiter);

  // Phase 2 feature routers
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/follow', followRouter);
  // Phase 3 feature routers
  app.use('/api/rooms', roomsRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/maps', mapsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/clubs', clubsRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/explore', exploreRouter);
  app.use('/api/push', pushRouter);
  // Godmode admin surface — gated by env.GODMODE_ENABLED + role middlewares
  // inside the router. Always mounted so the `/api/admin/me` probe stays
  // available; the writable endpoints reject non-admins.
  app.use('/api/admin', adminRouter);

  app.use(notFoundHandler);
  app.use(errorMiddleware);

  return app;
};

const startServer = async (): Promise<void> => {
  await connectRedis();
  await ensureSearchIndexes();
  // mediasoup boots best-effort: if the native build is unavailable the rest
  // of the API keeps working and rtc:* events return RTC_DISABLED.
  await initMediasoup().catch(err => {
    logger.warn('mediasoup init failed', { err: err instanceof Error ? err.message : err });
  });
  // Boot the reminder worker in-process. Spin out to its own service when
  // scheduled-room volume warrants it.
  startReminderWorker();
  const app = createApp();
  const server = http.createServer(app);
  const io = await createSocketServer(server);

  server.listen(env.PORT, env.HOST, () => {
    logger.info(
      `Chathouse API listening on http://${env.HOST}:${env.PORT} (${env.NODE_ENV}) — socket.io ready`,
    );
  });

  // Reference `io` so linters don't flag it; kept around for future
  // cross-module broadcasts (notifications fan-out, etc.).
  void io;

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received — graceful shutdown`);
    server.close(async () => {
      try {
        await shutdownMediasoup();
        await shutdownReminders();
        await disconnectDatabase();
        await disconnectRedis();
        logger.info('server stopped cleanly');
        process.exit(0);
      } catch (err) {
        logger.error('shutdown error', { err });
        process.exit(1);
      }
    });
    // Hard-kill after 10s if close() hangs
    setTimeout(() => {
      logger.error('forced shutdown after 10s');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('unhandledRejection', err => {
    logger.error('unhandledRejection', { err });
  });
  process.on('uncaughtException', err => {
    logger.error('uncaughtException', { err });
    void shutdown('uncaughtException');
  });
};

if (require.main === module) {
  void startServer();
}
