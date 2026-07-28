const COMPOSITE_CURSOR_PREFIX = 'v1.';
const MAX_CURSOR_LENGTH = 1024;
const MAX_ID_LENGTH = 512;
// Older versions emitted Date#toISOString(), whose UTC representation always
// has exactly three fractional-second digits.
const LEGACY_ISO_CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BASE64URL_PAYLOAD = /^[A-Za-z0-9_-]+$/;

export interface DecodedAdminCursor {
  createdAt: Date;
  /**
   * `null` identifies a legacy timestamp-only cursor. New cursors always carry
   * the row id so records sharing the same `createdAt` value cannot be skipped.
   */
  id: string | null;
}

const parseLegacyDate = (value: string): Date | null => {
  if (!LEGACY_ISO_CURSOR.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.toISOString() !== value ? null : date;
};

/**
 * Decode both the current opaque `(createdAt,id)` cursor and the timestamp-only
 * cursor returned by older API versions. Invalid cursors are rejected instead
 * of being coerced into a surprising database predicate.
 */
export const decodeAdminCursor = (value: string): DecodedAdminCursor | null => {
  if (!value || value.length > MAX_CURSOR_LENGTH) return null;

  const legacyDate = parseLegacyDate(value);
  if (legacyDate) return { createdAt: legacyDate, id: null };

  if (!value.startsWith(COMPOSITE_CURSOR_PREFIX)) return null;
  const payload = value.slice(COMPOSITE_CURSOR_PREFIX.length);
  if (!BASE64URL_PAYLOAD.test(payload)) return null;

  try {
    const bytes = Buffer.from(payload, 'base64url');
    // Node's base64 decoder is intentionally permissive. Requiring the
    // canonical round-trip prevents malformed aliases from becoming cursors.
    if (bytes.length === 0 || bytes.toString('base64url') !== payload) return null;

    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      typeof parsed[1] !== 'string' ||
      parsed[1].length === 0 ||
      parsed[1].length > MAX_ID_LENGTH
    ) {
      return null;
    }

    const createdAt = new Date(parsed[0]);
    if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== parsed[0]) return null;

    return { createdAt, id: parsed[1] };
  } catch {
    return null;
  }
};

export const encodeAdminCursor = (createdAt: Date, id: string): string => {
  if (!id || id.length > MAX_ID_LENGTH || Number.isNaN(createdAt.getTime())) {
    throw new Error('Cannot encode an invalid admin cursor');
  }

  const payload = Buffer.from(JSON.stringify([createdAt.toISOString(), id]), 'utf8').toString(
    'base64url',
  );
  return `${COMPOSITE_CURSOR_PREFIX}${payload}`;
};
