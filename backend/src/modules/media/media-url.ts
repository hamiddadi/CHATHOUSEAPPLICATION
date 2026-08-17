import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';

const signatureFor = (mediaId: string): string =>
  createHmac('sha256', env.MEDIA_URL_SIGNING_SECRET ?? env.JWT_ACCESS_SECRET)
    .update(`media:v1:${mediaId}`)
    .digest('base64url');

const expiringSignatureFor = (mediaId: string, expiresAt: string): string =>
  createHmac('sha256', env.MEDIA_URL_SIGNING_SECRET ?? env.JWT_ACCESS_SECRET)
    .update(`media:v2:${mediaId}:${expiresAt}`)
    .digest('base64url');

const referenceSignatureFor = (mediaId: string): string =>
  createHmac('sha256', env.MEDIA_URL_SIGNING_SECRET ?? env.JWT_ACCESS_SECRET)
    .update(`media:ref:v1:${mediaId}`)
    .digest('base64url');

const publicBase = (requestOrigin: string): string => {
  // Production always supplies PUBLIC_URL. Supertest intentionally allocates
  // a fresh ephemeral port per request, so use the configured local API port
  // in tests; an idempotent replay must return byte-for-byte the same URL even
  // when the transport listener changed.
  const canonical =
    env.PUBLIC_URL ?? (env.NODE_ENV === 'test' ? `http://localhost:${env.PORT}` : requestOrigin);
  return canonical.replace(/\/+$/, '');
};

const expiresAtFor = (ttlSeconds: number): string =>
  String(Math.ceil((Math.floor(Date.now() / 1000) + ttlSeconds) / 60) * 60);

export const mediaUrlFor = (mediaId: string, requestOrigin: string): string => {
  const expiresAt = expiresAtFor(env.MEDIA_APP_URL_TTL_SECONDS);
  return `${publicBase(requestOrigin)}/media/${mediaId}/${expiresAt}/${expiringSignatureFor(
    mediaId,
    expiresAt,
  )}`;
};

/**
 * Non-downloadable canonical reference persisted in relational URL columns.
 * Its HMAC prevents a caller from swapping ids, but `/media-ref/*` is never
 * mounted as a route. Transport boundaries turn it into a short-lived
 * `/media/*` capability with `materializePrivateMediaUrls`.
 */
export const mediaReferenceFor = (mediaId: string, requestOrigin: string): string =>
  `${publicBase(requestOrigin)}/media-ref/${mediaId}/${referenceSignatureFor(mediaId)}`;

/** Rolling-compatibility helper for URLs persisted before capabilities became
 * short-lived. New database writes must use mediaReferenceFor(). */
export const legacyStableMediaUrlFor = (mediaId: string, requestOrigin: string): string =>
  `${publicBase(requestOrigin)}/media/${mediaId}/${signatureFor(mediaId)}`;

export const expiringMediaUrlFor = (mediaId: string, requestOrigin: string): string => {
  const expiresAt = expiresAtFor(env.MEDIA_EXPORT_URL_TTL_SECONDS);
  return `${publicBase(requestOrigin)}/media/${mediaId}/${expiresAt}/${expiringSignatureFor(
    mediaId,
    expiresAt,
  )}`;
};

export const isValidMediaSignature = (
  mediaId: string,
  candidate: string,
  expiresAt?: string,
  { allowExpired = false }: { allowExpired?: boolean } = {},
): boolean => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(candidate)) return false;
  if (expiresAt !== undefined) {
    if (
      !/^\d{10}$/.test(expiresAt) ||
      (!allowExpired && Number(expiresAt) <= Math.floor(Date.now() / 1000))
    ) {
      return false;
    }
  }
  const expected = Buffer.from(
    expiresAt === undefined ? signatureFor(mediaId) : expiringSignatureFor(mediaId, expiresAt),
  );
  const actual = Buffer.from(candidate);
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
};

export const mediaIdFromSignedUrl = (
  url: string,
  {
    allowLegacyStable = true,
    allowExpired = false,
  }: { allowLegacyStable?: boolean; allowExpired?: boolean } = {},
): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'media') return null;
  if (parts.length === 4) {
    const [, id, expiresAt, signature] = parts;
    return id &&
      expiresAt &&
      signature &&
      isValidMediaSignature(id, signature, expiresAt, { allowExpired })
      ? id
      : null;
  }
  if (allowLegacyStable && parts.length === 3) {
    const [, id, signature] = parts;
    return id && signature && isValidMediaSignature(id, signature) ? id : null;
  }
  return null;
};

/** Resolve either the new non-routable reference or a signed legacy/current
 * download URL. Used only alongside an ownership/relationship DB check. */
export const mediaIdFromPrivateUrl = (
  url: string,
  { allowExpired = false }: { allowExpired?: boolean } = {},
): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts[0] === 'media-ref' && parts.length === 3) {
    const [, id, signature] = parts;
    if (!id || !signature || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;
    const expected = Buffer.from(referenceSignatureFor(id));
    const actual = Buffer.from(signature);
    return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual)
      ? id
      : null;
  }
  return mediaIdFromSignedUrl(url, { allowExpired });
};

/**
 * Resolve a persisted private-media reference only when it belongs to this
 * deployment's public origin. The HMAC proves the id was minted by us; the
 * origin check prevents an arbitrary external URL from becoming an
 * authoritative relational link merely because its path contains a valid
 * reference copied from elsewhere.
 */
export const mediaIdFromCanonicalPrivateUrl = (
  url: string,
  options: { allowExpired?: boolean } = {},
): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (env.PUBLIC_URL && parsed.origin !== new URL(env.PUBLIC_URL).origin) return null;
  return mediaIdFromPrivateUrl(parsed.toString(), options);
};

/**
 * Identify a private-media-shaped URL on this deployment even when its HMAC
 * is invalid. Importers use this to distinguish a genuine external cover from
 * a stale or forged internal reference, which must be neutralized.
 */
export const isCanonicalPrivateMediaPath = (url: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (env.PUBLIC_URL && parsed.origin !== new URL(env.PUBLIC_URL).origin) return false;
  const [kind] = parsed.pathname.split('/').filter(Boolean);
  return kind === 'media' || kind === 'media-ref';
};

const materializePrivateMediaUrl = (value: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return value;
  }

  // Only internal, non-routable references may mint a new capability. Never
  // renew an expired/current/legacy `/media/*` bearer found in arbitrary API
  // text (for example a user-controlled bio or chat message).
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'media-ref') return value;
  const id = mediaIdFromPrivateUrl(value);
  if (!id) return value;
  return mediaUrlFor(id, parsed.origin);
};

/**
 * Recursively replace internal media references in an API/socket payload with
 * fresh, short-lived capabilities. Values are cloned rather than mutated so
 * an outgoing response can never overwrite a canonical reference later used
 * by the same service call.
 */
export const materializePrivateMediaUrls = <T>(value: T): T => {
  const seen = new WeakMap<object, unknown>();

  const visit = (current: unknown): unknown => {
    if (typeof current === 'string') return materializePrivateMediaUrl(current);
    if (
      current === null ||
      typeof current !== 'object' ||
      current instanceof Date ||
      Buffer.isBuffer(current)
    ) {
      return current;
    }
    const cached = seen.get(current);
    if (cached !== undefined) return cached;
    if (Array.isArray(current)) {
      const output: unknown[] = [];
      seen.set(current, output);
      current.forEach(item => output.push(visit(item)));
      return output;
    }
    const prototype = Object.getPrototypeOf(current) as object | null;
    if (prototype !== Object.prototype && prototype !== null) return current;
    const output: Record<string, unknown> = {};
    seen.set(current, output);
    for (const [key, item] of Object.entries(current)) output[key] = visit(item);
    return output;
  };

  return visit(value) as T;
};
