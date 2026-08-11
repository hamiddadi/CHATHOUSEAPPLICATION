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

const firebaseServiceAccountFromString = z.preprocess(
  value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z
    .string()
    .trim()
    .superRefine((raw, ctx) => {
      try {
        const parsed: unknown = JSON.parse(raw);
        const result = z
          .object({
            type: z.literal('service_account'),
            project_id: z.string().trim().min(1),
            private_key: z.string().trim().min(1),
            client_email: z.string().trim().email(),
          })
          .passthrough()
          .safeParse(parsed);
        if (!result.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'FIREBASE_SERVICE_ACCOUNT must be a Firebase service-account JSON with type, project_id, private_key and client_email',
          });
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'FIREBASE_SERVICE_ACCOUNT must be valid JSON',
        });
      }
    })
    .optional(),
);

/**
 * Runtime environment — validated at process boot. Missing or malformed vars
 * cause the process to exit with code 1 before any route is registered.
 */
export const LIVEKIT_TOKEN_MAX_TTL_SECONDS = 300;

// Accept a legacy value above the current ceiling (notably 3600 from older
// local .env files), but clamp the parsed runtime value before it reaches the
// token signer. Invalid values still fail boot validation, and the resulting
// Env type can never carry an operational LiveKit token TTL above five minutes.
const livekitTokenTtlSecondsSchema = z.coerce
  .number()
  .int()
  .min(60)
  .default(LIVEKIT_TOKEN_MAX_TTL_SECONDS)
  .transform(ttl => Math.min(ttl, LIVEKIT_TOKEN_MAX_TTL_SECONDS))
  .pipe(z.number().int().min(60).max(LIVEKIT_TOKEN_MAX_TTL_SECONDS));

const optionalUrlFromString = z.preprocess(
  value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().url().optional(),
);

const optionalTrimmedString = z.preprocess(
  value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

const isPrivateIpv4 = (hostname: string): boolean => {
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet))) return false;
  const first = octets[0];
  const second = octets[1];
  if (first === undefined || second === undefined) return false;
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    octets.every(octet => octet === 0)
  );
};

const publicTlsUrlError = (rawValue: string, protocol: 'https:' | 'wss:'): string | null => {
  const url = new URL(rawValue);
  if (url.protocol !== protocol) return `must use ${protocol.slice(0, -1)}`;
  if (url.username || url.password) return 'must not contain credentials';

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || (!hostname.includes('.') && !hostname.includes(':'))) {
    return 'must use a fully-qualified public host';
  }
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.test') ||
    hostname.endsWith('.invalid') ||
    hostname.endsWith('.example') ||
    hostname === '::1' ||
    hostname === '0:0:0:0:0:0:0:1' ||
    /^(?:fc|fd|fe[89ab])/i.test(hostname) ||
    isPrivateIpv4(hostname)
  ) {
    return 'must not use a local or private host';
  }
  return null;
};

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

  // Canonical externally-reachable API origin. Required in production so
  // media capability URLs never contain an internal proxy/container host.
  PUBLIC_URL: z.string().url().optional(),

  // Public legal identity. Production pages (/privacy, /terms,
  // /community-guidelines, /child-safety, /account-deletion and /support) are
  // rendered from these values, and production refuses to boot while any
  // required value is missing or still contains a template marker.
  LEGAL_ENTITY_NAME: z.string().trim().min(2).optional(),
  LEGAL_REGISTERED_ADDRESS: z.string().trim().min(5).optional(),
  LEGAL_REGISTRATION_NUMBER: z.string().trim().min(2).optional(),
  LEGAL_JURISDICTION: z.string().trim().min(2).optional(),
  LEGAL_DISPUTE_PROCESS: z.string().trim().min(5).optional(),
  LEGAL_LIABILITY_TERMS: z.string().trim().min(5).optional(),
  LEGAL_SUPERVISORY_AUTHORITY: z.string().trim().min(2).optional(),
  LEGAL_TRANSFER_SAFEGUARDS: z.string().trim().min(5).optional(),
  LEGAL_DPO_CONTACT: z.string().trim().min(2).optional(),
  LEGAL_EU_REPRESENTATIVE: z.string().trim().min(2).optional(),
  LEGAL_DOCUMENT_VERSION: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'LEGAL_DOCUMENT_VERSION must be an ISO date')
    .optional(),
  LEGAL_DOCUMENT_EFFECTIVE_DATE: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'LEGAL_DOCUMENT_EFFECTIVE_DATE must be an ISO date')
    .optional(),
  LEGAL_SERVICE_PROVIDERS: z.string().trim().min(10).optional(),
  LEGAL_PROCESSING_LOCATIONS: z.string().trim().min(2).optional(),
  LEGAL_LOG_BACKUP_RETENTION: z.string().trim().min(5).optional(),
  LEGAL_SUPPORT_MODERATION_RETENTION: z.string().trim().min(5).optional(),
  LEGAL_MODERATION_APPEAL_ROUTE: z.string().trim().min(5).optional(),
  LEGAL_ADULT_CONTENT_POLICY: z.string().trim().min(5).optional(),
  LEGAL_CHILD_SAFETY_REPORTING_PROCESS: z.string().trim().min(5).optional(),
  LEGAL_CONTACT_PHONE: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, 'LEGAL_CONTACT_PHONE must use E.164 format')
    .optional(),
  PRIVACY_CONTACT_EMAIL: z.string().trim().email().optional(),
  SUPPORT_CONTACT_EMAIL: z.string().trim().email().optional(),
  SAFETY_CONTACT_EMAIL: z.string().trim().email().optional(),
  CHILD_SAFETY_CONTACT_NAME: z.string().trim().min(2).optional(),
  CHILD_SAFETY_CONTACT_EMAIL: z.string().trim().email().optional(),
  APPLE_TEAM_ID: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{10}$/, 'APPLE_TEAM_ID must be the 10-character Apple Team ID')
    .optional(),
  ANDROID_APP_SIGNING_SHA256: z
    .string()
    .trim()
    .refine(
      value => {
        const octets = value.split(':');
        return octets.length === 32 && octets.every(octet => /^[A-F0-9]{2}$/i.test(octet));
      },
      {
        message:
          'ANDROID_APP_SIGNING_SHA256 must be a colon-separated SHA-256 certificate fingerprint',
      },
    )
    .optional(),

  // Private media storage (avatars + voice notes). Local storage is allowed
  // only for development/test and is never exposed through express.static.
  // Production must use a private S3-compatible bucket.
  MEDIA_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  MEDIA_URL_SIGNING_SECRET: z.string().min(32).optional(),
  MEDIA_EXPORT_URL_TTL_SECONDS: z.coerce.number().int().min(300).max(604800).default(3600),
  MEDIA_S3_BUCKET: z.string().min(1).optional(),
  MEDIA_S3_REGION: z.string().min(1).default('us-east-1'),
  MEDIA_S3_ENDPOINT: z.string().url().optional(),
  MEDIA_S3_ACCESS_KEY: z.string().min(1).optional(),
  MEDIA_S3_SECRET_KEY: z.string().min(1).optional(),
  MEDIA_S3_FORCE_PATH_STYLE: boolFromString(false),
  // Uploads remain replayable for the full 24h idempotency window. Afterwards,
  // incomplete avatar/voice objects and unattached completed voices may be
  // reclaimed; completed avatars remain durable profile/club assets.
  VOICE_MEDIA_ABANDONED_TTL_HOURS: z.coerce.number().int().min(25).max(720).default(48),
  VOICE_MEDIA_DELETE_CLAIM_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  VOICE_MEDIA_CLEANUP_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
  VOICE_MEDIA_CLEANUP_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(5),
  VOICE_MEDIA_CLEANUP_CRON: z.string().trim().min(1).default('17 * * * *'),

  RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  // GDPR retention. Keep this validated so login restoration, API responses
  // and the purge worker cannot silently use different grace windows.
  ACCOUNT_DELETION_GRACE_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  GDPR_PURGE_CRON: z.string().trim().min(1).default('0 3 * * *'),

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
  LIVEKIT_URL: optionalUrlFromString,
  // Optional server-to-server endpoint for RoomService/Egress calls. This is
  // distinct from LIVEKIT_URL because a public/mobile URL such as
  // ws://127.0.0.1:7880 is not routable from inside the API container.
  // When absent, admin clients safely fall back to LIVEKIT_URL.
  LIVEKIT_INTERNAL_URL: optionalUrlFromString,
  LIVEKIT_API_KEY: optionalTrimmedString,
  LIVEKIT_API_SECRET: optionalTrimmedString,
  // Token TTL — clients renew ~30s before expiry so even short windows
  // are stable. The operational value is capped at five minutes to bound
  // stale audio access after a role change, kick, or room closure.
  LIVEKIT_TOKEN_TTL_SECONDS: livekitTokenTtlSecondsSchema,

  // ─── Recording / Egress (room Replays) ──────────────────────────────
  // Server-side room recording via LiveKit Egress → an S3-compatible bucket.
  // Entirely optional: recording is "configured" only when EGRESS_ENABLED is
  // true AND the bucket + keys below are set AND LiveKit itself is configured
  // (see recordings.service.isConfigured). When unconfigured, rooms still work
  // exactly as before — no Recording rows are ever created.
  ROOM_RECORDING_ENABLED: boolFromString(false),
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
  // Stripe is an optional sub-feature of the extensions bundle. It is enabled
  // only when STRIPE_SECRET_KEY is configured; production accepts all four
  // values absent, but rejects every partial Stripe configuration.
  STRIPE_SECRET_KEY: optionalTrimmedString,
  // Verifies incoming webhook signatures. Without it the webhook endpoint
  // rejects every event (fail closed) rather than trusting forged ones.
  STRIPE_WEBHOOK_SECRET: optionalTrimmedString,
  // Hosted-page return URLs (Connect onboarding + Checkout success/cancel +
  // billing portal). No placeholder fallback — flows fail closed when unset.
  STRIPE_RETURN_URL: optionalUrlFromString,
  STRIPE_REFRESH_URL: optionalUrlFromString,
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
  TWILIO_ACCOUNT_SID: z
    .string()
    .trim()
    .regex(/^AC[a-f0-9]{32}$/i, 'TWILIO_ACCOUNT_SID must be a valid Account SID')
    .optional(),
  TWILIO_AUTH_TOKEN: z
    .string()
    .trim()
    .min(16, 'TWILIO_AUTH_TOKEN must be at least 16 characters')
    .optional(),
  TWILIO_FROM_NUMBER: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, 'TWILIO_FROM_NUMBER must be an E.164 phone number')
    .optional(),

  // Password-reset email. Development/test deliberately use a non-delivering
  // stub, but production must have a real Resend transport configured.
  RESEND_API_KEY: z
    .string()
    .trim()
    .min(10, 'RESEND_API_KEY must be at least 10 characters')
    .startsWith('re_', 'RESEND_API_KEY must start with re_')
    .optional(),
  MAIL_FROM: z.string().trim().email('MAIL_FROM must be a valid email address').optional(),

  // ─── Push (Module 6) — Firebase Cloud Messaging via firebase-admin ───
  // Service-account credentials for firebase-admin (de-Expo: replaced the Expo
  // push proxy with direct FCM). Provide the full service-account JSON (Firebase
  // console → Project settings → Service accounts → Generate new private key) as
  // a single-line string in FIREBASE_SERVICE_ACCOUNT. As an alternative,
  // FIREBASE_USE_ADC=true explicitly selects Application Default Credentials
  // (workload identity, or GOOGLE_APPLICATION_CREDENTIALS managed by the
  // runtime). Production requires exactly one credential mode.
  FIREBASE_SERVICE_ACCOUNT: firebaseServiceAccountFromString,
  FIREBASE_USE_ADC: boolFromString(false),
  // When false (the default outside production), dispatchToUser logs the
  // payload instead of calling FCM. Production refuses to boot unless enabled.
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

if (env.NODE_ENV === 'production') {
  const serviceConfigErrors: string[] = [];
  const requiredLiveKitFields = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] as const;
  for (const field of requiredLiveKitFields) {
    if (!env[field]) serviceConfigErrors.push(`${field} is required in production`);
  }

  if (env.LIVEKIT_URL) {
    const error = publicTlsUrlError(env.LIVEKIT_URL, 'wss:');
    if (error) serviceConfigErrors.push(`LIVEKIT_URL ${error}`);
  }
  if (env.LIVEKIT_INTERNAL_URL) {
    const internalUrl = new URL(env.LIVEKIT_INTERNAL_URL);
    if (!['http:', 'https:'].includes(internalUrl.protocol)) {
      serviceConfigErrors.push('LIVEKIT_INTERNAL_URL must use http or https');
    }
    if (internalUrl.username || internalUrl.password) {
      serviceConfigErrors.push('LIVEKIT_INTERNAL_URL must not contain credentials');
    }
  }
  if (env.LIVEKIT_API_KEY && env.LIVEKIT_API_KEY.length < 8) {
    serviceConfigErrors.push('LIVEKIT_API_KEY must be at least 8 characters in production');
  }
  if (env.LIVEKIT_API_KEY && /\s/.test(env.LIVEKIT_API_KEY)) {
    serviceConfigErrors.push('LIVEKIT_API_KEY must not contain whitespace');
  }
  if (env.LIVEKIT_API_SECRET && env.LIVEKIT_API_SECRET.length < 32) {
    serviceConfigErrors.push('LIVEKIT_API_SECRET must be at least 32 characters in production');
  }
  if (env.LIVEKIT_API_SECRET && /\s/.test(env.LIVEKIT_API_SECRET)) {
    serviceConfigErrors.push('LIVEKIT_API_SECRET must not contain whitespace');
  }
  if (
    env.LIVEKIT_API_KEY &&
    env.LIVEKIT_API_SECRET &&
    env.LIVEKIT_API_KEY === env.LIVEKIT_API_SECRET
  ) {
    serviceConfigErrors.push('LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be distinct');
  }

  const stripeFields = [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_RETURN_URL',
    'STRIPE_REFRESH_URL',
  ] as const;
  const stripeRequested = stripeFields.some(field => Boolean(env[field]));
  if (stripeRequested) {
    if (!env.EXTENSIONS_ENABLED) {
      serviceConfigErrors.push(
        'EXTENSIONS_ENABLED must be true when the optional Stripe feature is configured',
      );
    }
    for (const field of stripeFields) {
      if (!env[field]) {
        serviceConfigErrors.push(`${field} is required when any Stripe configuration is provided`);
      }
    }

    if (env.STRIPE_SECRET_KEY && !/^sk_live_[A-Za-z0-9]{24,}$/.test(env.STRIPE_SECRET_KEY)) {
      serviceConfigErrors.push('STRIPE_SECRET_KEY must be a production sk_live_ key');
    }
    if (env.STRIPE_WEBHOOK_SECRET && !/^whsec_[A-Za-z0-9]{24,}$/.test(env.STRIPE_WEBHOOK_SECRET)) {
      serviceConfigErrors.push('STRIPE_WEBHOOK_SECRET must be a production whsec_ signing secret');
    }
    for (const field of ['STRIPE_RETURN_URL', 'STRIPE_REFRESH_URL'] as const) {
      const value = env[field];
      if (!value) continue;
      const error = publicTlsUrlError(value, 'https:');
      if (error) serviceConfigErrors.push(`${field} ${error}`);
    }
    if (
      env.STRIPE_SECRET_KEY &&
      env.STRIPE_WEBHOOK_SECRET &&
      env.STRIPE_SECRET_KEY === env.STRIPE_WEBHOOK_SECRET
    ) {
      serviceConfigErrors.push('STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be distinct');
    }
  }

  const reusableSecrets = [
    ['JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET],
    ['JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET],
    ['MEDIA_URL_SIGNING_SECRET', env.MEDIA_URL_SIGNING_SECRET],
    ['LIVEKIT_API_SECRET', env.LIVEKIT_API_SECRET],
  ] as const;
  for (let index = 0; index < reusableSecrets.length; index += 1) {
    const [field, value] = reusableSecrets[index] as (typeof reusableSecrets)[number];
    if (!value) continue;
    const duplicate = reusableSecrets
      .slice(index + 1)
      .find(([, candidate]) => candidate && candidate === value);
    if (duplicate) {
      serviceConfigErrors.push(`${field} and ${duplicate[0]} must use distinct secrets`);
    }
  }

  if (serviceConfigErrors.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `❌ Invalid production LiveKit/Stripe configuration:\n- ${serviceConfigErrors.join('\n- ')}`,
    );
    process.exit(1);
  }
}

if (env.NODE_ENV === 'production') {
  const requiredDeliveryFields = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_FROM_NUMBER',
    'RESEND_API_KEY',
    'MAIL_FROM',
  ] as const;
  const missingDeliveryFields = requiredDeliveryFields.filter(field => !env[field]);

  if (missingDeliveryFields.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `❌ Invalid production delivery configuration:\n- ${missingDeliveryFields
        .map(field => `${field} is required in production`)
        .join('\n- ')}`,
    );
    process.exit(1);
  }
}

if (env.NODE_ENV === 'production') {
  const requiredLegalFields = [
    'LEGAL_ENTITY_NAME',
    'LEGAL_REGISTERED_ADDRESS',
    'LEGAL_REGISTRATION_NUMBER',
    'LEGAL_JURISDICTION',
    'LEGAL_DISPUTE_PROCESS',
    'LEGAL_LIABILITY_TERMS',
    'LEGAL_SUPERVISORY_AUTHORITY',
    'LEGAL_TRANSFER_SAFEGUARDS',
    'LEGAL_DPO_CONTACT',
    'LEGAL_EU_REPRESENTATIVE',
    'LEGAL_DOCUMENT_VERSION',
    'LEGAL_DOCUMENT_EFFECTIVE_DATE',
    'LEGAL_SERVICE_PROVIDERS',
    'LEGAL_PROCESSING_LOCATIONS',
    'LEGAL_LOG_BACKUP_RETENTION',
    'LEGAL_SUPPORT_MODERATION_RETENTION',
    'LEGAL_MODERATION_APPEAL_ROUTE',
    'LEGAL_ADULT_CONTENT_POLICY',
    'LEGAL_CHILD_SAFETY_REPORTING_PROCESS',
    'LEGAL_CONTACT_PHONE',
    'PRIVACY_CONTACT_EMAIL',
    'SUPPORT_CONTACT_EMAIL',
    'SAFETY_CONTACT_EMAIL',
    'CHILD_SAFETY_CONTACT_NAME',
    'CHILD_SAFETY_CONTACT_EMAIL',
    'APPLE_TEAM_ID',
    'ANDROID_APP_SIGNING_SHA256',
  ] as const;
  const placeholder =
    /change[_ -]?me|placeholder|replace|your[_ -]|example\.(com|net|org|test|invalid)|\b(todo|tbd|unknown|draft|not published|pending confirmation)\b|\[[^\]]+\]|not applicable outside production/i;
  const invalidLegalFields = requiredLegalFields.filter(field => {
    const value = env[field];
    return !value || placeholder.test(value);
  });

  if (invalidLegalFields.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `❌ Invalid production legal configuration:\n- ${invalidLegalFields
        .map(field => `${field} must contain the reviewed production value`)
        .join('\n- ')}`,
    );
    process.exit(1);
  }
}

if (env.NODE_ENV === 'production') {
  const pushConfigErrors: string[] = [];
  if (!env.PUSH_DISPATCH_ENABLED) {
    pushConfigErrors.push('PUSH_DISPATCH_ENABLED must be true in production');
  }

  const configuredCredentialModes =
    Number(Boolean(env.FIREBASE_SERVICE_ACCOUNT)) + Number(env.FIREBASE_USE_ADC);
  if (configuredCredentialModes === 0) {
    pushConfigErrors.push(
      'set FIREBASE_SERVICE_ACCOUNT or explicitly enable FIREBASE_USE_ADC in production',
    );
  } else if (configuredCredentialModes > 1) {
    pushConfigErrors.push(
      'FIREBASE_SERVICE_ACCOUNT and FIREBASE_USE_ADC are mutually exclusive; configure exactly one',
    );
  }

  if (pushConfigErrors.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`❌ Invalid production push configuration:\n- ${pushConfigErrors.join('\n- ')}`);
    process.exit(1);
  }
}

// Defense in depth: refuse to boot in production if a secret still holds a
// well-known DEV default (e.g. copied from docker-compose.yml). docker-compose.prod.yml
// already REQUIRES these vars, but a copy-paste of a dev value would otherwise
// pass silently. Fails safe — only trips in production, only on an exact match.
if (env.NODE_ENV === 'production') {
  const DEV_DEFAULTS = [
    ['JWT_ACCESS_SECRET', 'dev_only_access_secret_change_me_0123456789abcdef'],
    ['JWT_REFRESH_SECRET', 'dev_only_refresh_secret_change_me_0123456789abcdef'],
    ['LIVEKIT_API_KEY', 'devkey'],
    ['LIVEKIT_API_SECRET', 'devsecretdevsecretdevsecretdevsecret'],
    ['RESEND_API_KEY', 're___CHANGE_ME__'],
  ] as const;
  const offenders = DEV_DEFAULTS.filter(([key, devValue]) => env[key] === devValue).map(
    ([key]) => key,
  );
  if (offenders.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `❌ Refusing to start in production: these secrets still hold their DEV default — ${offenders.join(', ')}. Set real values (see backend/.env.prod.example).`,
    );
    process.exit(1);
  }
}

const mediaConfigErrors: string[] = [];
if (env.NODE_ENV === 'production' && env.MEDIA_STORAGE_DRIVER !== 's3') {
  mediaConfigErrors.push('MEDIA_STORAGE_DRIVER must be s3 in production');
}
if (env.NODE_ENV === 'production' && !env.PUBLIC_URL) {
  mediaConfigErrors.push('PUBLIC_URL is required in production');
}
if (env.NODE_ENV === 'production' && !env.MEDIA_URL_SIGNING_SECRET) {
  mediaConfigErrors.push('MEDIA_URL_SIGNING_SECRET is required in production');
}
if (env.MEDIA_STORAGE_DRIVER === 's3' && !env.MEDIA_S3_BUCKET) {
  mediaConfigErrors.push('MEDIA_S3_BUCKET is required when MEDIA_STORAGE_DRIVER=s3');
}
if (Boolean(env.MEDIA_S3_ACCESS_KEY) !== Boolean(env.MEDIA_S3_SECRET_KEY)) {
  mediaConfigErrors.push(
    'MEDIA_S3_ACCESS_KEY and MEDIA_S3_SECRET_KEY must either both be set or both be unset',
  );
}
if (mediaConfigErrors.length > 0) {
  // eslint-disable-next-line no-console
  console.error(`❌ Invalid private media configuration:\n- ${mediaConfigErrors.join('\n- ')}`);
  process.exit(1);
}
