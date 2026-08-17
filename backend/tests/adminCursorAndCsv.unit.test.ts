import { decodeAdminCursor, encodeAdminCursor } from '../src/modules/admin/admin.cursor';
import { adminCursorSchema } from '../src/modules/admin/admin.schema';
import { csvCell } from '../src/modules/admin/admin.service';

describe('admin pagination cursors', () => {
  const createdAt = new Date('2026-07-20T12:34:56.789Z');

  it('round-trips the stable (createdAt,id) tuple as an opaque cursor', () => {
    const encoded = encodeAdminCursor(createdAt, 'report_cuid_123');

    expect(encoded).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    expect(decodeAdminCursor(encoded)).toEqual({
      createdAt,
      id: 'report_cuid_123',
    });
    expect(adminCursorSchema.safeParse(encoded).success).toBe(true);
  });

  it('keeps timestamp-only cursors from older API versions compatible', () => {
    expect(decodeAdminCursor(createdAt.toISOString())).toEqual({
      createdAt,
      id: null,
    });
    expect(adminCursorSchema.safeParse(createdAt.toISOString()).success).toBe(true);
  });

  it.each([
    '',
    'not-a-cursor',
    'v1.',
    'v1.***',
    'v1.e30',
    '2026-02-30T12:00:00.000Z',
    `v1.${Buffer.from(JSON.stringify(['not-a-date', 'id'])).toString('base64url')}`,
    `v1.${Buffer.from(JSON.stringify([createdAt.toISOString(), ''])).toString('base64url')}`,
  ])('rejects malformed cursor %p', cursor => {
    expect(decodeAdminCursor(cursor)).toBeNull();
    expect(adminCursorSchema.safeParse(cursor).success).toBe(false);
  });
});

describe('admin CSV formula neutralisation', () => {
  it.each([
    '=HYPERLINK("https://attacker.invalid")',
    '   +cmd|calc',
    '\tbenign-looking tab-prefixed text',
    ' \rformula after carriage return',
    '\nformula after newline',
    '\u00a0@SUM(1,1)',
    '\f  -2+3',
    ' \t=1+1',
    '\ufeff=1+1',
  ])('prefixes dangerous user-controlled value %p with an explicit text marker', value => {
    expect(csvCell(value)).toBe(`"'${value.replace(/"/g, '""')}"`);
  });

  it('keeps RFC 4180 quoting valid while preserving safe content', () => {
    expect(csvCell('safe, "quoted"\nsecond line')).toBe('"safe, ""quoted""\nsecond line"');
    expect(csvCell('apostrophe-first')).toBe('"apostrophe-first"');
    expect(csvCell(-42)).toBe('"-42"');
    expect(csvCell(null)).toBe('""');
  });
});
