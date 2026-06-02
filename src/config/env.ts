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

export const env = parsed.data;
export type Env = typeof env;

export const isDev = env.ENV === 'development';
export const isProd = env.ENV === 'production';
