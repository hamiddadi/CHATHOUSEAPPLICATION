import 'dotenv/config';
import { z } from 'zod';

/**
 * Strict boolean parser for env flags. `z.coerce.boolean()` applies
 * `Boolean(string)`, so ANY non-empty string — including 'false', '0',
 * 'off' — coerces to `true`. That silently broke kill-switches like
 * GODMODE_ENABLED=false. This only treats 'true'/'1' (case-insensitive)
 * as true; everything else (and unset) falls back to `def`.
 */
const boolFromString = (def: boolean) =>
  z
    .string()
    .optional()
    .transform(v => {
      if (v === undefined) return def;
      const s = v.trim().toLowerCase();
      return s === 'true' || s === '1';
    });

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
  GODMODE_ENABLED: boolFromString(true),

  // When true, the main entry point (dist/app.js) also mounts the
  // `/api/ext/*` extension routers so the API contract is identical
  // regardless of which entry point boots. Default true so the documented
  // extension features are actually reachable in production.
  EXTENSIONS_ENABLED: boolFromString(true),

  // ─── LiveKit (audio engine) ─────────────────────────────────────────
  // LIVEKIT_URL is the WebSocket endpoint of the LiveKit server. Shipped
  // to clients via the token response (never hardcoded in the bundle).
  // API_KEY and API_SECRET are used to sign per-room JWT tokens — the
  // secret must NEVER leak to the bundle.
  // When unset, /rooms/:id/livekit-token returns 503.
  LIVEKIT_URL: z.string().min(1).optional(),
  LIVEKIT_API_KEY: z.string().min(1).optional(),
  LIVEKIT_API_SECRET: z.string().min(1).optional(),
  // Token TTL — clients renew ~30s before expiry so even short windows
  // are stable. 1h is a sensible default; raise for low-traffic setups.
  LIVEKIT_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),

  // ─── Recording / Egress (room Replays) ──────────────────────────────
  // Server-side room recording via LiveKit Egress → an S3-compatible bucket.
  // Entirely optional: recording is "configured" only when EGRESS_ENABLED is
  // true AND the bucket + keys below are set AND LiveKit itself is configured
  // (see recordings.service.isConfigured). When unconfigured, rooms still work
  // exactly as before — no Recording rows are ever created.
  EGRESS_ENABLED: boolFromString(false),
  RECORDING_S3_BUCKET: z.string().optional(),
  RECORDING_S3_REGION: z.string().optional(),
  RECORDING_S3_ACCESS_KEY: z.string().optional(),
  RECORDING_S3_SECRET: z.string().optional(),
  // Custom S3 endpoint for non-AWS providers (Cloudflare R2, MinIO, GCS S3
  // interop). Leave unset for AWS S3.
  RECORDING_S3_ENDPOINT: z.string().optional(),
  // Public base URL the stored objects are served from (e.g. an R2 public
  // bucket URL or a CloudFront distribution). The object key is appended to
  // build the playback URL; falls back to the egress-reported location.
  RECORDING_PUBLIC_BASE_URL: z.string().optional(),

  // ─── Monetization (Stripe tips + premium) ───────────────────────────
  // All optional: payments + premium are feature-flagged and no-op when unset
  // (mirrors the LiveKit/recording gating). The `stripe` npm package itself is
  // an optional dynamic import — install it in backend/ to actually charge.
  STRIPE_SECRET_KEY: z.string().optional(),
  // Verifies incoming webhook signatures. Without it the webhook endpoint
  // rejects every event (fail closed) rather than trusting forged ones.
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // Hosted-page return URLs (Connect onboarding + Checkout success/cancel +
  // billing portal). No placeholder fallback — flows fail closed when unset.
  STRIPE_RETURN_URL: z.string().url().optional(),
  STRIPE_REFRESH_URL: z.string().url().optional(),
  // Premium plan: monthly price in minor units + the product label shown on
  // the Stripe-hosted Checkout page.
  PREMIUM_PRICE_CENTS: z.coerce.number().int().positive().default(499),
  PREMIUM_PRODUCT_NAME: z.string().default('ChatHouse Premium'),
  // Supported payment currencies (lower-case ISO-4217), comma-separated; the
  // first is the default. Restricted to 2-decimal currencies since amounts are
  // minor units — add zero-decimal handling before enabling JPY/KRW/etc.
  PAYMENT_CURRENCIES: z
    .string()
    .default('usd,eur,gbp,cad,aud')
    .transform((s, ctx) => {
      const list = s
        .split(',')
        .map(c => c.trim().toLowerCase())
        .filter(Boolean);
      // Amounts are treated as 2-decimal minor units (× 100). Zero-decimal
      // currencies (JPY, KRW, …) would be mis-scaled 100×, so reject them at
      // boot rather than silently overcharge — honour the comment above.
      const ZERO_DECIMAL = [
        'bif',
        'clp',
        'djf',
        'gnf',
        'jpy',
        'kmf',
        'krw',
        'mga',
        'pyg',
        'rwf',
        'ugx',
        'vnd',
        'vuv',
        'xaf',
        'xof',
        'xpf',
      ];
      const bad = list.filter(c => ZERO_DECIMAL.includes(c));
      if (bad.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `PAYMENT_CURRENCIES contains unsupported zero-decimal currencies (add minor-unit handling first): ${bad.join(', ')}`,
        });
        return z.NEVER;
      }
      return list;
    }),

  // mediasoup (phase 4). Disabled by default because the npm package compiles
  // C++ from source at install time — turn ON in docker-compose only.
  MEDIASOUP_ENABLED: boolFromString(false),
  MEDIASOUP_ANNOUNCED_IP: z.string().default('127.0.0.1'),
  MEDIASOUP_LISTEN_IP: z.string().default('0.0.0.0'),
  MEDIASOUP_RTC_MIN_PORT: z.coerce.number().int().min(1024).max(65535).default(40000),
  MEDIASOUP_RTC_MAX_PORT: z.coerce.number().int().min(1024).max(65535).default(40019),
  MEDIASOUP_NUM_WORKERS: z.coerce.number().int().positive().max(16).optional(),

  // ─── OTP / SMS (Module 1) ────────────────────────────
  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(5),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(5),
  // Dev/QA test numbers: comma-separated phone numbers (E.164 or bare national
  // digits) that skip the real SMS/OTP and log in with the fixed OTP_TEST_CODE.
  // Matched by digit-suffix so the country code the client prepends is
  // irrelevant (e.g. "550728585" matches the "+213550728585" the app sends).
  // HARD-GATED to non-production in otp.service — inert when NODE_ENV=production
  // so it can never weaken a live deployment. Empty = feature off.
  OTP_TEST_NUMBERS: z.string().default(''),
  OTP_TEST_CODE: z
    .string()
    .regex(/^[0-9]{6}$/, 'OTP_TEST_CODE must be 6 digits')
    .default('000000'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  // ─── Push (Module 6) — Firebase Cloud Messaging via firebase-admin ───
  // Service-account credentials for firebase-admin (de-Expo: replaced the Expo
  // push proxy with direct FCM). Provide the full service-account JSON (Firebase
  // console → Project settings → Service accounts → Generate new private key) as
  // a single-line string in FIREBASE_SERVICE_ACCOUNT, or point
  // GOOGLE_APPLICATION_CREDENTIALS at a JSON file path (admin SDK default). With
  // neither set, dispatch warns + skips (see PUSH_DISPATCH_ENABLED).
  FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
  // When false (the default outside production), dispatchToUser logs the
  // payload instead of calling FCM. Flip on in prod so push reaches devices.
  PUSH_DISPATCH_ENABLED: boolFromString(false),

  // ICE servers — JSON array string sent to clients for NAT traversal.
  // Default uses Google's public STUN only; for prod add a TURN server
  // (coturn sidecar in docker-compose, or a hosted TURN provider).
  ICE_SERVERS_JSON: z
    .string()
    .default('[{"urls":"stun:stun.l.google.com:19302"}]')
    .transform((raw, ctx) => {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('not an array');
        // Validate the element shape instead of blindly casting, so a
        // malformed entry is caught at boot rather than at NAT-traversal time.
        const iceServerSchema = z.object({
          urls: z.union([z.string(), z.array(z.string())]),
          username: z.string().optional(),
          credential: z.string().optional(),
        });
        return z.array(iceServerSchema).parse(parsed);
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
