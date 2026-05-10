import { env, isDev } from '../../config/env';

/**
 * Opaque crash-reporter wrapper. Lazy-loads `@sentry/react-native` to keep
 * Expo Go working when the dep isn't installed.
 *
 * To enable in a dev client / EAS build:
 *   1. npm install @sentry/react-native
 *   2. Add the config plugin to app.json:
 *      {"plugins": ["@sentry/react-native/expo", ...]}
 *   3. Set the SENTRY_DSN EAS secret (see README.env.md).
 * No code changes needed — this file auto-detects the package at runtime.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type SentryLike = {
  init: (opts: { dsn: string; enableAutoSessionTracking?: boolean; environment?: string }) => void;
  captureException: (err: unknown, hint?: { extra?: Record<string, unknown> }) => void;
  captureMessage: (msg: string, level?: 'info' | 'warning' | 'error') => void;
};

let sentry: SentryLike | null = null;
let initialized = false;
// Default: disabled. The privacy/analytics consent store flips this on
// once the user opts in. Without consent, every report() is a no-op even
// if Sentry is otherwise wired up.
let consentEnabled = false;

const loadSentry = (): SentryLike | null => {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    return require('@sentry/react-native') as SentryLike;
    /* eslint-enable @typescript-eslint/no-require-imports */
  } catch {
    return null;
  }
};

export const initReporter = (): void => {
  if (initialized) return;
  initialized = true;
  if (isDev) return; // never report in dev — noise
  if (!env.SENTRY_DSN) return; // no DSN, silently skip

  sentry = loadSentry();
  if (!sentry) return;

  sentry.init({
    dsn: env.SENTRY_DSN,
    enableAutoSessionTracking: true,
    environment: env.ENV,
  });
};

export const reportException = (err: unknown, extra?: Record<string, unknown>): void => {
  if (isDev) {
    // eslint-disable-next-line no-console
    console.error('[reporter] dev capture', err, extra);
    return;
  }
  if (!consentEnabled) return;
  sentry?.captureException(err, extra ? { extra } : undefined);
};

export const reportMessage = (msg: string, level: 'info' | 'warning' | 'error' = 'info'): void => {
  if (isDev) {
    // eslint-disable-next-line no-console
    console.info(`[reporter] ${level}: ${msg}`);
    return;
  }
  if (!consentEnabled) return;
  sentry?.captureMessage(msg, level);
};

/**
 * Toggle the reporter at runtime — bound to the GDPR analytics-consent
 * store. Disabling stops outbound events immediately for the rest of the
 * session; re-enabling resumes capture without a restart.
 */
export const setReporterEnabled = (enabled: boolean): void => {
  consentEnabled = enabled;
};
/* eslint-enable @typescript-eslint/no-explicit-any */
