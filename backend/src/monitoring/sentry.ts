import * as Sentry from '@sentry/node';
import type { ErrorEvent } from '@sentry/node';
import { sanitizeRequestUrl } from '../utils/sanitizeRequestUrl';

/**
 * Strip request identity and bearer-like URL capabilities before an error
 * leaves the process. Exported as a pure helper so the privacy contract stays
 * directly testable without initializing a real Sentry client.
 */
export const sanitizeSentryEvent = (event: ErrorEvent): ErrorEvent => {
  event.user = undefined;
  if (event.request) {
    event.request.cookies = undefined;
    event.request.data = undefined;
    event.request.headers = undefined;
    event.request.query_string = undefined;
    if (event.request.url) event.request.url = sanitizeRequestUrl(event.request.url);
  }
  for (const breadcrumb of event.breadcrumbs ?? []) {
    if (!breadcrumb.data) continue;
    delete breadcrumb.data['headers'];
    delete breadcrumb.data['request_body'];
    const url = breadcrumb.data['url'];
    if (typeof url === 'string') breadcrumb.data['url'] = sanitizeRequestUrl(url);
  }
  return event;
};

/**
 * Sentry error monitoring (SDK v10).
 *
 * Current SDK notes:
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

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    // Server error reporting is a narrowly-scoped reliability/security
    // control. Performance tracing is disabled to avoid collecting behavioural
    // request trails; mobile diagnostics have their own explicit opt-in gate.
    tracesSampleRate: 0,
    sendDefaultPii: false,
    integrations: [Sentry.httpIntegration()],
    beforeSend: sanitizeSentryEvent,
  });
}

export { Sentry };
