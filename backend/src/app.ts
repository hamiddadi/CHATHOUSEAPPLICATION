import http from 'node:http';
import express, {
  json as expressJson,
  urlencoded as expressUrlencoded,
  static as expressStatic,
} from 'express';
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
import { groupsRouter } from './modules/groups/groups.router';
import { mapsRouter } from './modules/maps/maps.router';
import { notificationsRouter } from './modules/notifications/notifications.router';
import { clubsRouter } from './modules/clubs/clubs.router';
import { searchRouter } from './modules/search/search.router';
import { exploreRouter } from './modules/explore/explore.router';
import { pushRouter } from './modules/push/push.router';
import { adminRouter } from './modules/admin/admin.router';
import { uploadRouter } from './modules/upload/upload.router';
import { recordingsRouter } from './modules/recordings/recordings.router';
import { livekitWebhookRouter } from './modules/recordings/recordings.webhook';
import { stripeWebhookRouter } from './extensions/modules/payments/payments.webhook';
import { UPLOADS_DIR } from './modules/upload/upload.service';
import { createSocketServer } from './socket/socket.server';
import { mountExtensions } from './extensions/mount';
import { setRealtimeAliasServer } from './extensions/realtime/aliases';
import { initMediasoup, shutdownMediasoup } from './webrtc/mediasoup.manager';
import { startReminderWorker, shutdownReminders } from './queues/eventReminders';
import { startLocationPurgeWorker, shutdownLocationPurge } from './queues/locationPurge';
import { ensureSearchIndexes } from './config/searchIndexes';

// Grace period before a hung server.close() is hard-killed during shutdown.
const SHUTDOWN_GRACE_MS = 10_000;

export const createApp = (): express.Express => {
  const app = express();

  app.set('trust proxy', 1);

  // LiveKit egress webhook — mounted BEFORE the JSON parser because signature
  // verification needs the raw request body (the router installs its own
  // express.raw parser). Unauthenticated by design; the signed Authorization
  // header is the auth. No-op unless egress is configured.
  app.use('/webhooks', livekitWebhookRouter);
  // Stripe webhook (POST /webhooks/stripe) — same raw-body-before-JSON-parser
  // requirement; verified with STRIPE_WEBHOOK_SECRET. No-op/503 unless Stripe is
  // configured. Syncs the tip ledger + premium entitlements (the only writer).
  app.use('/webhooks', stripeWebhookRouter);

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

  // Serve locally-stored uploads (avatars). Public + unratelimited so the
  // mobile app's <Image> can fetch them without a bearer token, and mounted
  // BEFORE the /api globalLimiter so image loads don't burn the API budget.
  // express.static creates no directory itself; upload.service.ts mkdirs it
  // on first write. The crossOriginResourcePolicy: 'cross-origin' helmet
  // setting above lets RN/web clients on other origins load these.
  app.use('/uploads', expressStatic(UPLOADS_DIR));

  // OpenAPI/Swagger UI — unauthenticated, so keep it out of production to
  // avoid handing an attacker a free map of the API surface. Browse the
  // contract in dev/staging, or front it with requireAuth+requireAdmin if
  // you must expose it in prod. Mount BEFORE the /api globalLimiter.
  if (env.NODE_ENV !== 'production') {
    app.use('/api/docs', docsRouter);
  }

  // Everything else is under /api and globally rate-limited.
  app.use('/api', globalLimiter);

  // Phase 2 feature routers
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/follow', followRouter);
  // Phase 3 feature routers
  app.use('/api/rooms', roomsRouter);
  app.use('/api/recordings', recordingsRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/groups', groupsRouter);
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
  // Avatar upload (local-disk, no multer). Mounts its own 8 MB JSON parser
  // internally since the global 1 MB cap is too small for base64 images.
  app.use('/api/upload', uploadRouter);

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
  await startLocationPurgeWorker();
  const app = createApp();
  // Mount the `/api/ext/*` extension contract on the SAME entry point that
  // production uses (`dist/app.js`), gated by env. Previously these routers
  // were only mounted by the alternate `extensions/server.ts`, so the whole
  // extension surface 404'd under the default `npm start`.
  if (env.EXTENSIONS_ENABLED) {
    mountExtensions(app);
  }
  const server = http.createServer(app);
  const io = await createSocketServer(server);
  // Bind the alias emitter so extension realtime events publish under their
  // Clubhouse-spec names (e.g. `room_title_updated`).
  if (env.EXTENSIONS_ENABLED) {
    setRealtimeAliasServer(io);
  }

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
        await shutdownLocationPurge();
        await disconnectDatabase();
        await disconnectRedis();
        logger.info('server stopped cleanly');
        process.exit(0);
      } catch (err) {
        logger.error('shutdown error', { err });
        process.exit(1);
      }
    });
    // Hard-kill after the grace period if close() hangs
    setTimeout(() => {
      logger.error(`forced shutdown after ${SHUTDOWN_GRACE_MS / 1000}s`);
      process.exit(1);
    }, SHUTDOWN_GRACE_MS).unref();
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
