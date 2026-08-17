import { env, isDev } from '../../config/env';

/**
 * Consent-gated crash-reporter wrapper. Sentry is loaded only after opt-in,
 * never in development, and only when a production DSN is configured.
 *
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type SentryLike = {
  init: (opts: {
    dsn: string;
    enableAutoSessionTracking: boolean;
    environment?: string;
    sendDefaultPii: boolean;
    tracesSampleRate: number;
    beforeSend: (event: unknown) => unknown | null;
    beforeSendTransaction: (event: unknown) => unknown | null;
  }) => void;
  close?: (timeout?: number) => Promise<boolean>;
  setUser?: (user: null) => void;
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
  if (!consentEnabled) return;
  if (isDev) return; // never report in dev — noise
  if (!env.SENTRY_DSN) return; // no DSN, silently skip

  sentry = loadSentry();
  if (!sentry) return;

  sentry.init({
    dsn: env.SENTRY_DSN,
    enableAutoSessionTracking: false,
    environment: env.ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: event => (consentEnabled ? event : null),
    beforeSendTransaction: event => (consentEnabled ? event : null),
  });
  initialized = true;
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
  if (enabled) {
    initReporter();
    return;
  }
  sentry?.setUser?.(null);
  if (sentry?.close) void sentry.close(2_000);
  sentry = null;
  initialized = false;
};
/* eslint-enable @typescript-eslint/no-explicit-any */
