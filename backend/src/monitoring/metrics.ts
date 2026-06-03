import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { collectDefaultMetrics, Counter, Gauge, Histogram, register } from 'prom-client';

/**
 * Prometheus metrics for the Chathouse API.
 *
 * All custom and default metrics are namespaced with the `chathouse_` prefix
 * so a single Prometheus instance can scrape several services without label
 * collisions. The `/metrics` endpoint is served by {@link metricsHandler};
 * per-request timings are recorded by {@link httpMetricsMiddleware}.
 *
 * Wiring (kept out of this module so it stays import-side-effect-light beyond
 * the default-metrics registration):
 *   app.use(httpMetricsMiddleware);          // early, before routers
 *   app.get('/metrics', metricsHandler);     // protect by IP allowlist in prod
 */

// Default Node.js process / GC / event-loop metrics, prefixed so they line up
// with our custom series (e.g. chathouse_process_resident_memory_bytes,
// chathouse_nodejs_heap_size_used_bytes). collectDefaultMetrics is idempotent
// per registry but we guard anyway in case the module is imported twice under
// ts-node/tsx module duplication.
const DEFAULT_METRICS_FLAG = Symbol.for('chathouse.defaultMetricsRegistered');
const globalFlags = globalThis as typeof globalThis & {
  [DEFAULT_METRICS_FLAG]?: boolean;
};
if (!globalFlags[DEFAULT_METRICS_FLAG]) {
  collectDefaultMetrics({ prefix: 'chathouse_' });
  globalFlags[DEFAULT_METRICS_FLAG] = true;
}

/** Standard label set for HTTP series. */
const HTTP_LABELS = ['method', 'route', 'status_code'] as const;

/**
 * Histogram of HTTP request durations in seconds, labelled by method, route
 * and status_code. Buckets span sub-10ms calls up to slow 10s requests.
 */
export const httpRequestDuration = new Histogram({
  name: 'chathouse_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: HTTP_LABELS,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

/** Counter of total HTTP requests, labelled by method, route and status_code. */
export const httpRequestTotal = new Counter({
  name: 'chathouse_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: HTTP_LABELS,
});

/** Current number of live Socket.IO / WebSocket connections. */
export const wsConnectionsGauge = new Gauge({
  name: 'chathouse_ws_connections',
  help: 'Number of active WebSocket (Socket.IO) connections',
});

/** Histogram of database query durations in seconds, labelled by operation/model. */
export const dbQueryDuration = new Histogram({
  name: 'chathouse_db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation', 'model'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});

/**
 * Gauge of BullMQ jobs by queue and state. Update from a periodic collector,
 * e.g. for each queue: bullmqJobsGauge.set({ queue, state: 'waiting' }, count).
 * States typically tracked: waiting, active, completed, failed, delayed.
 */
export const bullmqJobsGauge = new Gauge({
  name: 'chathouse_bullmq_jobs',
  help: 'Number of BullMQ jobs by queue and state',
  labelNames: ['queue', 'state'] as const,
});

/**
 * Optional gauge for the Prisma/PG connection pool. Populate from a periodic
 * collector if you expose pool stats; referenced by the DBPoolSaturated alert.
 */
export const dbPoolConnectionsGauge = new Gauge({
  name: 'chathouse_db_pool_connections',
  help: 'Database connection pool usage by state (active, idle, max)',
  labelNames: ['state'] as const,
});

/**
 * Express middleware that times each request and records the HTTP histogram +
 * counter. Mount it as early as practical so the timer covers downstream
 * middleware. The route label prefers the matched Express route pattern
 * (req.route?.path) to avoid high-cardinality raw paths (e.g. /api/users/:id
 * instead of /api/users/123); it falls back to req.path when no route matched
 * (404s, static, etc.).
 */
export const httpMetricsMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const endTimer = httpRequestDuration.startTimer();

  res.on('finish', () => {
    // baseUrl + route.path reconstructs the mounted pattern (router mounted at
    // /api/users with route '/:id' -> '/api/users/:id'). Fall back to req.path.
    const routePath =
      typeof req.route?.path === 'string' ? `${req.baseUrl}${req.route.path}` : req.path;

    const labels = {
      method: req.method,
      route: routePath,
      status_code: String(res.statusCode),
    } as const;

    httpRequestTotal.inc(labels);
    endTimer(labels);
  });

  next();
};

/**
 * Express handler for GET /metrics. Returns the Prometheus exposition format.
 * Protect with an IP allowlist (or auth) in production so the metric surface
 * is not publicly enumerable.
 */
export const metricsHandler: RequestHandler = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err instanceof Error ? err.message : 'metrics error');
  }
};

/** The default prom-client registry, re-exported for advanced/custom collectors. */
export { register };
