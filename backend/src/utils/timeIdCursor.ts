const CURSOR_PREFIX = 'v1.';
const MAX_CURSOR_LENGTH = 1024;
const MAX_ID_LENGTH = 512;
const LEGACY_ISO_CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BASE64URL_PAYLOAD = /^[A-Za-z0-9_-]+$/;

export interface DecodedTimeIdCursor {
  createdAt: Date;
  /** `null` identifies a timestamp-only cursor emitted by an older server. */
  id: string | null;
}

const parseLegacyDate = (value: string): Date | null => {
  if (!LEGACY_ISO_CURSOR.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.toISOString() !== value ? null : date;
};

/**
 * Decodes an opaque, stable `(createdAt,id)` cursor. Timestamp-only ISO
 * cursors remain accepted so an app can continue a page started against an
 * older API version during a rolling deployment.
 */
export const decodeTimeIdCursor = (value: string): DecodedTimeIdCursor | null => {
  if (!value || value.length > MAX_CURSOR_LENGTH) return null;

  const legacyDate = parseLegacyDate(value);
  if (legacyDate) return { createdAt: legacyDate, id: null };

  if (!value.startsWith(CURSOR_PREFIX)) return null;
  const payload = value.slice(CURSOR_PREFIX.length);
  if (!BASE64URL_PAYLOAD.test(payload)) return null;

  try {
    const bytes = Buffer.from(payload, 'base64url');
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

export const encodeTimeIdCursor = (createdAt: Date, id: string): string => {
  if (!id || id.length > MAX_ID_LENGTH || Number.isNaN(createdAt.getTime())) {
    throw new Error('Cannot encode an invalid time/id cursor');
  }

  const payload = Buffer.from(JSON.stringify([createdAt.toISOString(), id]), 'utf8').toString(
    'base64url',
  );
  return `${CURSOR_PREFIX}${payload}`;
};
