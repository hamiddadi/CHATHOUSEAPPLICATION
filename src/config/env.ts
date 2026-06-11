import * as ExpoConstants from 'expo-constants';
import { z } from 'zod';

const Constants = ExpoConstants.default;

/**
 * Runtime env — sourced from `app.config.js → extra`. Zod validates on boot
 * and throws at startup if anything is malformed, so we never race on undefined
 * `env.API_BASE_URL` at runtime. EAS Build injects `process.env.*` into the
 * config at bundle time; dev with Expo Go falls back to the defaults.
 */
const envSchema = z.object({
  API_BASE_URL: z.string().url().default('http://localhost:4000/api'),
  WS_BASE_URL: z.string().default('ws://localhost:4000'),
  REALTIME_ENABLED: z
    .union([z.boolean(), z.string()])
    .default(false)
    .transform(v => v === true || v === 'true'),
  ENV: z.enum(['development', 'staging', 'production']).default('development'),
  SENTRY_DSN: z.string().url().optional(),

  // ─── LiveKit (audio engine) ───────────────────────────────
  // LIVEKIT_URL is the WebSocket endpoint of the LiveKit server.
  // The backend signs tokens — no secrets needed client-side.
  // The URL is also returned in the token response, but having it
  // here allows early connection setup.
  LIVEKIT_URL: z.string().min(1).optional(),
});

const extra = Constants.expoConfig?.extra ?? {};
const parsed = envSchema.safeParse(extra);

if (!parsed.success) {
  // Surface the first issue in the release bundle (console.error survives
  // `no-console: warn` lint rule) and throw so the app doesn't boot with
  // garbage values silently.
  // eslint-disable-next-line no-console
  console.error('[env] Invalid Expo config extra:', parsed.error.flatten());
  throw new Error('Invalid Expo config — see logs.');
}

// Fail-fast guard: a production bundle must NEVER ship pointing at a local /
// dev endpoint or a cleartext (http/ws) URL — that is the single most common
// store-launch footgun (the app installs fine but can never reach its backend,
// and iOS ATS / Android cleartext policy reject plain http/ws in prod).
// Caught here at boot rather than as a silent network failure on real devices.
if (parsed.data.ENV === 'production') {
  const urls = [parsed.data.API_BASE_URL, parsed.data.WS_BASE_URL, parsed.data.LIVEKIT_URL ?? ''];
  const local = /localhost|127\.0\.0\.1|10\.0\.2\.2|0\.0\.0\.0|192\.168\.|::1/;
  const offendingLocal = urls.find(u => local.test(u));
  if (offendingLocal) {
    throw new Error(
      `[env] Production build points at a local/dev endpoint (${offendingLocal}). ` +
        'Set API_BASE_URL / WS_BASE_URL / LIVEKIT_URL as EAS secrets to the public production hosts.',
    );
  }
  const cleartext =
    parsed.data.API_BASE_URL.startsWith('http://') ||
    parsed.data.WS_BASE_URL.startsWith('ws://') ||
    (parsed.data.LIVEKIT_URL ?? '').startsWith('ws://');
  if (cleartext) {
    throw new Error(
      '[env] Production endpoints must use https:// and wss:// (no cleartext http/ws).',
    );
  }
}

export const env = parsed.data;
export type Env = typeof env;

export const isDev = env.ENV === 'development';
export const isProd = env.ENV === 'production';
