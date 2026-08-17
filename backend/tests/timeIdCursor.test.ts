import { decodeTimeIdCursor, encodeTimeIdCursor } from '../src/utils/timeIdCursor';

describe('time/id cursor', () => {
  it('round-trips an opaque composite cursor', () => {
    const createdAt = new Date('2026-08-10T12:34:56.789Z');
    const encoded = encodeTimeIdCursor(createdAt, 'row-42');

    expect(encoded).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    expect(decodeTimeIdCursor(encoded)).toEqual({ createdAt, id: 'row-42' });
  });

  it('accepts a canonical legacy ISO timestamp but rejects malformed values', () => {
    expect(decodeTimeIdCursor('2026-08-10T12:34:56.789Z')).toEqual({
      createdAt: new Date('2026-08-10T12:34:56.789Z'),
      id: null,
    });
    expect(decodeTimeIdCursor('2026-08-10')).toBeNull();
    expect(decodeTimeIdCursor('v1.!!!!')).toBeNull();
    expect(decodeTimeIdCursor('v1.e30')).toBeNull();
  });
});
