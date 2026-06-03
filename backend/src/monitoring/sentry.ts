import * as Sentry from '@sentry/node';

/**
 * Sentry error & performance monitoring (SDK v8).
 *
 * v8 notes:
 *  - The HTTP integration is `Sentry.httpIntegration()` — the v7-era
 *    `new Sentry.Integrations.Http()` was removed and will not compile.
 *  - `@sentry/tracing` is obsolete; tracing is merged into `@sentry/node`.
 *
 * No-ops when SENTRY_DSN is unset so local/dev and CI runs never emit events
 * or require a network round-trip. Call {@link initSentry} once, as early as
 * possible in startup (before other services connect) so instrumentation can
 * patch the HTTP layer.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    // Intentionally silent: absence of a DSN is the normal local/dev state.
    return;
  }

  const isProd = process.env.NODE_ENV === 'production';

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    // Lower trace sampling in prod to control cost; full sampling elsewhere.
    tracesSampleRate: isProd ? 0.1 : 1.0,
    integrations: [Sentry.httpIntegration()],
  });
}

export { Sentry };
