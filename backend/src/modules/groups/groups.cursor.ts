import { decodeTimeIdCursor, encodeTimeIdCursor } from '../../utils/timeIdCursor';

export interface DecodedGroupCursor {
  updatedAt: Date;
  conversationId: string;
}

/**
 * Decode a group-list cursor. Unlike older time-based feeds, this endpoint
 * never emitted timestamp-only cursors, so accepting one would make equal
 * `updatedAt` rows impossible to traverse without gaps.
 */
export const decodeGroupCursor = (value: string): DecodedGroupCursor | null => {
  const decoded = decodeTimeIdCursor(value);
  return decoded?.id ? { updatedAt: decoded.createdAt, conversationId: decoded.id } : null;
};

export const encodeGroupCursor = (updatedAt: Date, conversationId: string): string =>
  encodeTimeIdCursor(updatedAt, conversationId);
