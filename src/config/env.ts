import * as ExpoConstants from 'expo-constants';
import { z } from 'zod';

const Constants = ExpoConstants.default;

/**
 * Runtime env — sourced from `app.config.js → extra`. Zod validates on boot
 * and throws at startup if anything is malformed, so we never race on undefined
 * `env.API_BASE_URL` at runtime. EAS Build injects `process.env.*` into the
 * config at bundle time; dev with Expo Go falls back to the defaults.
 */
const envSchema = z
  .object({
    API_BASE_URL: z.string().url().default('http://localhost:4000/api'),
    WS_BASE_URL: z.string().default('ws://localhost:4000'),
    REALTIME_ENABLED: z
      .union([z.boolean(), z.string()])
      .default(false)
      .transform(v => v === true || v === 'true'),
    ENV: z.enum(['development', 'staging', 'production']).default('development'),
    SENTRY_DSN: z.string().url().optional(),

    // ─── Agora (audio engine) ────────────────────────────────
    // AGORA_APP_ID is the public app identifier — safe to ship in client
    // builds. The PRIMARY_CERTIFICATE / SECONDARY_CERTIFICATE are SECRETS
    // and MUST NEVER be embedded in the client bundle — the backend signs
    // tokens using them. The temp token below is short-lived (max 24h)
    // and is fine for development; production must call a token endpoint.
    AGORA_APP_ID: z.string().min(1).optional(),
    AGORA_DEFAULT_CHANNEL: z.string().min(1).default('CHATHOUSE'),
    AGORA_TEMP_TOKEN: z.string().min(1).optional(),
  })
  // SEC: the temp token, although short-lived (24h), is embedded IN CLEAR in
  // the shipped JS bundle via expoConfig.extra. It must NEVER be present in a
  // production build (it would be extractable by decompiling the bundle).
  // Boot fails loudly if an operator wires AGORA_TEMP_TOKEN in a prod build.
  // Defence in depth: app.config.js also strips the token from expoConfig.extra
  // when envTag === 'production', so it never reaches the bundle in the first
  // place; this refine is the boot-time backstop.
  .refine(data => !data.AGORA_TEMP_TOKEN || data.ENV !== 'production', {
    message: 'AGORA_TEMP_TOKEN ne doit jamais être défini en production',
    path: ['AGORA_TEMP_TOKEN'],
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
