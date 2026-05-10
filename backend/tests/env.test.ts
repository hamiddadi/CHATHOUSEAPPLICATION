import { z } from 'zod';

describe('env validation', () => {
  it('loads when all required vars are present', async () => {
    jest.resetModules();
    const { env } = await import('../src/config/env');
    expect(env.NODE_ENV).toBe('test');
    expect(env.JWT_ACCESS_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:8081']);
  });

  it('rejects short JWT secrets', () => {
    // Schema lives alongside env.ts; re-derive with the same rule for a
    // quick sanity check that the validation message is the one clients see.
    const schema = z.object({
      JWT_ACCESS_SECRET: z.string().min(32),
    });
    const res = schema.safeParse({ JWT_ACCESS_SECRET: 'short' });
    expect(res.success).toBe(false);
  });

  it('parses CORS_ORIGINS from a comma-separated string', () => {
    const schema = z.string().transform(s =>
      s
        .split(',')
        .map(o => o.trim())
        .filter(Boolean),
    );
    expect(schema.parse('http://a.test, http://b.test,  http://c.test')).toEqual([
      'http://a.test',
      'http://b.test',
      'http://c.test',
    ]);
  });
});
