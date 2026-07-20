import http from 'node:http';
import express, { json as expressJson, urlencoded as expressUrlencoded } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan, { token as registerMorganToken } from 'morgan';
import { env } from './config/env';
import { logger } from './config/logger';
import { connectRedis, disconnectRedis } from './config/redis';
import { disconnectDatabase } from './config/database';
import { globalLimiter } from './middlewares/rateLimit.middleware';
import { errorMiddleware, notFoundHandler } from './middlewares/error.middleware';
import { healthRouter } from './routes/health';
import { docsRouter } from './routes/docs';
import { legalRouter } from './routes/legal';
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
import { mediaRouter } from './modules/media/media.router';
import { recordingsRouter } from './modules/recordings/recordings.router';
import { livekitWebhookRouter } from './modules/recordings/recordings.webhook';
import { stripeWebhookRouter } from './extensions/modules/payments/payments.webhook';
import { createSocketServer, drainRoomDisconnectCleanups } from './socket/socket.server';
import {
  mountExtensions,
  shutdownExtensionWorkers,
  startExtensionWorkers,
} from './extensions/mount';
import { setRealtimeAliasServer } from './extensions/realtime/aliases';
import { initMediasoup, shutdownMediasoup } from './webrtc/mediasoup.manager';
import { startReminderWorker, shutdownReminders } from './queues/eventReminders';
import { startLocationPurgeWorker, shutdownLocationPurge } from './queues/locationPurge';
import { registerGdprPurgeWorker, shutdownGdprPurge } from './workers/gdpr-purge.worker';
import { ensureSearchIndexes } from './config/searchIndexes';
import { initSentry } from './monitoring/sentry';
import { httpMetricsMiddleware, metricsHandler } from './monitoring/metrics';
import { drainBackgroundTasks } from './utils/backgroundTasks';

// Grace period before a hung Socket.IO/HTTP shutdown is hard-killed.
const SHUTDOWN_GRACE_MS = 10_000;

// Access logs must never retain search terms, reset tokens or any other query
// parameter. Route paths remain useful for operations while the query string is
// discarded before it reaches the logger.
registerMorganToken('safe-url', request => {
  const req = request as http.IncomingMessage & { originalUrl?: string };
  return (req.originalUrl ?? req.url ?? '').split('?', 1)[0] ?? '';
});

const ACCESS_LOG_FORMAT =
  ':remote-addr [:date[iso]] ":method :safe-url HTTP/:http-version" :status :res[content-length] :response-time ms';

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

  // Keep signed media capability tokens out of access logs. The route has a
  // dedicated public-read limiter and streams only private stored objects.
  app.use('/media', mediaRouter);

  app.use(
    morgan(ACCESS_LOG_FORMAT, {
      stream: { write: (line: string) => logger.info(line.trim()) },
    }),
  );

  // Record per-request Prometheus timings. Mounted early so the histogram
  // covers downstream middleware/routers; uses the matched route pattern as
  // the label to avoid high-cardinality raw paths.
  app.use(httpMetricsMiddleware);

  // Prometheus scrape endpoint. In production it is fail-CLOSED: a METRICS_TOKEN
  // must be configured and presented as `Authorization: Bearer <token>`, so the
  // metric surface is never publicly enumerable on a prod deploy that forgot to
  // set the token. Outside production it stays open for local/dev scraping (with
  // optional token enforcement when one is set). Mounted BEFORE the /api
  // globalLimiter so scrapes don't burn the API budget.
  app.get('/metrics', (req, res, next) => {
    const token = process.env.METRICS_TOKEN;
    if (env.NODE_ENV === 'production' && !token) {
      res.status(403).end();
      return;
    }
    if (token && req.get('authorization') !== `Bearer ${token}`) {
      res.status(403).end();
      return;
    }
    void metricsHandler(req, res, next);
  });

  // Health is unauthenticated and unratelimited (Kubernetes/ECS probes).
  app.use(healthRouter);
  // Public, static store-compliance resources. They contain no scripts, forms
  // or user data and remain reachable even when the API documentation is off.
  app.use(legalRouter);

  // Authenticate and rate-limit before parsing base64 payloads. This route
  // owns a 12 MB parser and therefore has to precede the global 1 MB parser.
  app.use('/api/upload', uploadRouter);

  app.use(expressJson({ limit: '1mb' }));
  app.use(expressUrlencoded({ extended: true, limit: '1mb' }));

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
  if (env.EXTENSIONS_ENABLED) {
    mountExtensions(app);
  }
  app.use(notFoundHandler);
  app.use(errorMiddleware);

  return app;
};

export const startServer = async (): Promise<void> => {
  // Initialise error tracking FIRST — as early as possible so the HTTP
  // instrumentation can patch the layer before any service connects. No-op
  // when SENTRY_DSN is unset (the normal local/dev/CI state).
  initSentry();
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
  // GDPR retention sweep (daily cron). Applies the policy in
  // docs/rgpd/data-retention-policy.md: hard-deletes soft-deleted accounts past
  // the grace window and purges expired tokens/OTPs/audit logs.
  await registerGdprPurgeWorker();
  const app = createApp();
  if (env.EXTENSIONS_ENABLED) {
    startExtensionWorkers();
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

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received — graceful shutdown`);
    // Arm the deadline before awaiting network teardown so a stuck close is
    // still bounded.
    const forceTimer = setTimeout(() => {
      logger.error(`forced shutdown after ${SHUTDOWN_GRACE_MS / 1000}s`);
      process.exit(1);
    }, SHUTDOWN_GRACE_MS).unref();

    try {
      await io.close();
      await drainRoomDisconnectCleanups();
      await shutdownMediasoup();
      await shutdownReminders();
      await shutdownLocationPurge();
      await shutdownGdprPurge();
      if (env.EXTENSIONS_ENABLED) {
        await shutdownExtensionWorkers();
      }
      await drainBackgroundTasks();
      await disconnectDatabase();
      await disconnectRedis();
      clearTimeout(forceTimer);
      logger.info('server stopped cleanly');
      process.exit(0);
    } catch (err) {
      logger.error('shutdown error', { err });
      process.exit(1);
    }
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
