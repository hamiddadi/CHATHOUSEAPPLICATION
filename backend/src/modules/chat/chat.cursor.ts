const COMPOSITE_CURSOR_PREFIX = 'v1.';
const MAX_CURSOR_LENGTH = 1024;
const MAX_ID_LENGTH = 512;
const LEGACY_ISO_CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BASE64URL_PAYLOAD = /^[A-Za-z0-9_-]+$/;

export interface DecodedChatCursor {
  createdAt: Date;
  /** `null` identifies a timestamp-only cursor emitted by older servers. */
  messageId: string | null;
}

const parseLegacyDate = (value: string): Date | null => {
  if (!LEGACY_ISO_CURSOR.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.toISOString() !== value ? null : date;
};

/**
 * Decode the stable `(lastMessage.createdAt,lastMessage.id)` cursor while
 * accepting the timestamp-only cursor returned by older API versions.
 */
export const decodeChatCursor = (value: string): DecodedChatCursor | null => {
  if (!value || value.length > MAX_CURSOR_LENGTH) return null;

  const legacyDate = parseLegacyDate(value);
  if (legacyDate) return { createdAt: legacyDate, messageId: null };

  if (!value.startsWith(COMPOSITE_CURSOR_PREFIX)) return null;
  const payload = value.slice(COMPOSITE_CURSOR_PREFIX.length);
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

    return { createdAt, messageId: parsed[1] };
  } catch {
    return null;
  }
};

export const encodeChatCursor = (createdAt: Date, messageId: string): string => {
  if (!messageId || messageId.length > MAX_ID_LENGTH || Number.isNaN(createdAt.getTime())) {
    throw new Error('Cannot encode an invalid chat cursor');
  }

  const payload = Buffer.from(
    JSON.stringify([createdAt.toISOString(), messageId]),
    'utf8',
  ).toString('base64url');
  return `${COMPOSITE_CURSOR_PREFIX}${payload}`;
};
