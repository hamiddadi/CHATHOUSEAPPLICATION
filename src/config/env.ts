import { z } from 'zod';
import { API_BASE_URL, WS_BASE_URL, REALTIME_ENABLED, ENV, SENTRY_DSN, LIVEKIT_URL } from '@env';

export const normalizeOptionalEnvUrl = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/**
 * Runtime env — inlined at bundle time by react-native-dotenv from the root
 * `.env` (de-Expo: was `app.config.js → extra` read via expo-constants). Zod
 * validates on boot and throws at startup if anything is malformed, so we never
 * race on undefined `env.API_BASE_URL` at runtime. Keys missing from `.env`
 * resolve to `undefined` and fall back to the defaults below; CI must write the
 * correct `.env` before bundling a release.
 */
const envSchema = z.object({
  API_BASE_URL: z.string().url().default('http://localhost:4000/api'),
  WS_BASE_URL: z.string().default('ws://localhost:4000'),
  REALTIME_ENABLED: z
    .union([z.boolean(), z.string()])
    .default(false)
    .transform(v => v === true || v === 'true'),
  ENV: z.enum(['development', 'staging', 'production']).default('development'),
  // An empty value is the documented way to disable Sentry in an env file.
  // Normalize it before URL validation instead of crashing an otherwise valid
  // production bundle at startup.
  SENTRY_DSN: z.preprocess(normalizeOptionalEnvUrl, z.string().url().optional()),

  // ─── LiveKit (audio engine) ───────────────────────────────
  // LIVEKIT_URL is the WebSocket endpoint of the LiveKit server.
  // The backend signs tokens — no secrets needed client-side.
  // The URL is also returned in the token response, but having it
  // here allows early connection setup.
  LIVEKIT_URL: z.string().min(1).optional(),
});

interface ProductionEnvironmentCandidate {
  API_BASE_URL: string;
  WS_BASE_URL: string;
  REALTIME_ENABLED: boolean;
  ENV: 'development' | 'staging' | 'production';
  LIVEKIT_URL?: string;
}

const RELEASE_PLACEHOLDER =
  /change[_-]?me|placeholder|replace[-_.]?with|your[-_.]?project|example\.(?:com|net|org|test)|__[a-z0-9_-]+__/i;

const looksLikeIpv4 = (host: string): boolean => {
  const parts = host.split('.');
  return (
    parts.length === 4 &&
    parts.every(
      part =>
        part.length >= 1 &&
        part.length <= 3 &&
        [...part].every(character => character >= '0' && character <= '9'),
    )
  );
};

const isPrivateOrLocalHost = (host: string): boolean => {
  const normalized = host.toLowerCase();
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    normalized.startsWith('::ffff:127.')
  ) {
    return true;
  }

  if (looksLikeIpv4(normalized)) {
    const ipv4Parts = normalized.split('.');
    const first = Number(ipv4Parts[0]);
    const second = Number(ipv4Parts[1]);
    return (
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      normalized === '0.0.0.0'
    );
  }

  const firstHextetText = normalized.split(':', 1)[0] ?? '';
  if (!/^[0-9a-f]{1,4}$/.test(firstHextetText)) return false;
  const firstHextet = Number.parseInt(firstHextetText, 16);
  return (
    (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) ||
    (firstHextet >= 0xfe80 && firstHextet <= 0xfebf)
  );
};

const validPortSuffix = (suffix: string): boolean => {
  if (suffix === '') return true;
  if (!/^:\d{1,5}$/.test(suffix)) return false;
  const port = Number(suffix.slice(1));
  return port >= 1 && port <= 65_535;
};

const validIpv4 = (host: string): boolean =>
  !looksLikeIpv4(host) || host.split('.').every(part => Number(part) <= 255);

const urlHost = (value: string, expectedScheme: 'https' | 'wss'): string | null => {
  const prefix = `${expectedScheme}://`;
  if (!value.toLowerCase().startsWith(prefix) || /\s/.test(value)) return null;

  const authority = value.slice(prefix.length).split(/[/?#]/, 1)[0];
  if (!authority || authority.includes('@')) return null;
  if (authority.startsWith('[')) {
    const closingBracket = authority.indexOf(']');
    if (closingBracket <= 1 || !validPortSuffix(authority.slice(closingBracket + 1))) return null;
    return authority.slice(1, closingBracket).toLowerCase();
  }
  // IPv6 literals must be bracketed. For ordinary hosts, allow at most one
  // optional numeric TCP port.
  if ((authority.match(/:/g) ?? []).length > 1) return null;
  const separator = authority.indexOf(':');
  const host = (separator === -1 ? authority : authority.slice(0, separator)).toLowerCase();
  const portSuffix = separator === -1 ? '' : authority.slice(separator);
  return host && validPortSuffix(portSuffix) && validIpv4(host) ? host : null;
};

const assertPublicProductionUrl = (
  label: 'API_BASE_URL' | 'WS_BASE_URL' | 'LIVEKIT_URL',
  value: string,
  expectedScheme: 'https' | 'wss',
): void => {
  const host = urlHost(value, expectedScheme);
  const isSingleLabelHost =
    host !== null && !looksLikeIpv4(host) && !host.includes('.') && !host.includes(':');
  if (!host || isPrivateOrLocalHost(host) || isSingleLabelHost || RELEASE_PLACEHOLDER.test(value)) {
    throw new Error(
      `[env] ${label} must use ${expectedScheme}:// with a public, non-placeholder production host.`,
    );
  }
};

/**
 * Final cross-platform release guard. Native Android/iOS build scripts reject
 * bad inputs before bundling; this check also fails closed if a bundle is ever
 * produced through an unexpected path.
 */
export const assertProductionEnvironment = (candidate: ProductionEnvironmentCandidate): void => {
  if (candidate.ENV !== 'production') return;
  if (!candidate.REALTIME_ENABLED) {
    throw new Error('[env] Production requires REALTIME_ENABLED=true.');
  }
  if (!candidate.LIVEKIT_URL) {
    throw new Error('[env] Production requires LIVEKIT_URL.');
  }
  assertPublicProductionUrl('API_BASE_URL', candidate.API_BASE_URL, 'https');
  assertPublicProductionUrl('WS_BASE_URL', candidate.WS_BASE_URL, 'wss');
  assertPublicProductionUrl('LIVEKIT_URL', candidate.LIVEKIT_URL, 'wss');
};

const extra = {
  API_BASE_URL,
  WS_BASE_URL,
  REALTIME_ENABLED,
  ENV,
  SENTRY_DSN,
  LIVEKIT_URL,
};
const parsed = envSchema.safeParse(extra);

if (!parsed.success) {
  // Surface the first issue in the release bundle (console.error survives
  // `no-console: warn` lint rule) and throw so the app doesn't boot with
  // garbage values silently.
  // eslint-disable-next-line no-console
  console.error('[env] Invalid environment (@env / react-native-dotenv):', parsed.error.flatten());
  throw new Error('Invalid environment configuration — see logs.');
}

assertProductionEnvironment(parsed.data);

export const env = parsed.data;
export type Env = typeof env;

export const isDev = env.ENV === 'development';
export const isProd = env.ENV === 'production';
