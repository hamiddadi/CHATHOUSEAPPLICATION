import { decodeGroupCursor, encodeGroupCursor } from '../src/modules/groups/groups.cursor';
import { listGroupsSchema } from '../src/modules/groups/groups.schema';

describe('group list cursor contract', () => {
  const updatedAt = new Date('2026-08-13T12:34:56.789Z');

  it('round-trips the stable updatedAt/conversationId boundary', () => {
    const cursor = encodeGroupCursor(updatedAt, 'group-42');

    expect(cursor).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    expect(decodeGroupCursor(cursor)).toEqual({ updatedAt, conversationId: 'group-42' });
    expect(listGroupsSchema.parse({ limit: '25', cursor, paginated: 'true' })).toMatchObject({
      limit: 25,
      cursor,
      paginated: true,
    });
  });

  it.each(['', 'not-a-cursor', updatedAt.toISOString(), `v1.${'a'.repeat(1024)}`])(
    'rejects malformed or unsupported cursor %p',
    cursor => {
      expect(decodeGroupCursor(cursor)).toBeNull();
      expect(() => listGroupsSchema.parse({ cursor, paginated: 'true' })).toThrow();
    },
  );

  it('requires explicit paginated mode whenever a cursor is supplied', () => {
    const cursor = encodeGroupCursor(updatedAt, 'group-42');

    expect(() => listGroupsSchema.parse({ cursor })).toThrow();
  });

  it.each(['0', '101', '2.5', 'not-a-number'])('rejects invalid limit %p', limit => {
    expect(() => listGroupsSchema.parse({ limit })).toThrow();
  });
});
