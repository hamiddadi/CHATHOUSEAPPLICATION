import 'dotenv/config';
import { z } from 'zod';

/**
 * Runtime environment — validated at process boot. Missing or malformed vars
 * cause the process to exit with code 1 before any route is registered.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:8081')
    .transform(s =>
      s
        .split(',')
        .map(o => o.trim())
        .filter(Boolean),
    ),

  RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  // Master switch for the Godmode admin surface. When false, every
  // /api/admin/* endpoint returns ADMIN_003 even for SUPER_ADMINs — useful
  // for an emergency lockdown without redeploying.
  GODMODE_ENABLED: z.coerce.boolean().default(true),

  // ─── Agora (audio engine) ──────────────────────────────────────────
  // APP_ID is shipped to clients (it's public). PRIMARY_CERTIFICATE is a
  // SECRET used to sign per-room tokens — must NEVER leak to the bundle.
  // SECONDARY_CERTIFICATE is the rolling key for zero-downtime rotation.
  // When unset, /rooms/:id/agora-token returns 503 and the client falls
  // back to its env-baked temp token (dev-only path).
  AGORA_APP_ID: z.string().min(1).optional(),
  AGORA_PRIMARY_CERTIFICATE: z.string().min(1).optional(),
  AGORA_SECONDARY_CERTIFICATE: z.string().min(1).optional(),
  // Token TTL — clients renew ~30s before expiry so even short windows
  // are stable. 1h is a sensible default; raise for low-traffic setups.
  AGORA_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),

  // mediasoup (phase 4). Disabled by default because the npm package compiles
  // C++ from source at install time — turn ON in docker-compose only.
  MEDIASOUP_ENABLED: z.coerce.boolean().default(false),
  MEDIASOUP_ANNOUNCED_IP: z.string().default('127.0.0.1'),
  MEDIASOUP_LISTEN_IP: z.string().default('0.0.0.0'),
  MEDIASOUP_RTC_MIN_PORT: z.coerce.number().int().min(1024).max(65535).default(40000),
  MEDIASOUP_RTC_MAX_PORT: z.coerce.number().int().min(1024).max(65535).default(40019),
  MEDIASOUP_NUM_WORKERS: z.coerce.number().int().positive().max(16).optional(),

  // ─── OTP / SMS (Module 1) ────────────────────────────
  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(5),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(5),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  // ─── Push (Module 6) ─────────────────────────────────
  // Expo's push endpoint. Override for self-hosted receivers or when
  // using a custom FCM proxy. No access token required for basic use;
  // set EXPO_ACCESS_TOKEN when you need higher rate limits.
  EXPO_PUSH_URL: z.string().url().default('https://exp.host/--/api/v2/push/send'),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  // When false (the default outside production), sendToExpo logs the
  // payload instead of calling the HTTP endpoint. Flip on in prod so
  // push actually reaches devices.
  PUSH_DISPATCH_ENABLED: z.coerce.boolean().default(false),

  // ICE servers — JSON array string sent to clients for NAT traversal.
  // Default uses Google's public STUN only; for prod add a TURN server
  // (coturn sidecar in docker-compose, or a hosted TURN provider).
  ICE_SERVERS_JSON: z
    .string()
    .default('[{"urls":"stun:stun.l.google.com:19302"}]')
    .transform((raw, ctx) => {
      try {
        const parsed = JSON.parse(raw) as { urls: string | string[] }[];
        if (!Array.isArray(parsed)) throw new Error('not an array');
        return parsed;
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `ICE_SERVERS_JSON must be a JSON array of iceServer objects: ${err instanceof Error ? err.message : 'parse error'}`,
        });
        return z.NEVER;
      }
    }),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment variables:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
