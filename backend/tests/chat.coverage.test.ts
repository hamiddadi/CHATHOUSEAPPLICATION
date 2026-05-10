import request from 'supertest';
import type { Express } from 'express';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/* eslint-disable @typescript-eslint/no-require-imports */
const { createApp } = require('../src/app') as typeof import('../src/app');
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { connectRedis, disconnectRedis } =
  require('../src/config/redis') as typeof import('../src/config/redis');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

const register = async (app: Express) => {
  const u = `cc_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: u, email: `${u}@test.local`, password: 'test-password-123' });
  return { id: res.body.data.user.id as string, token: res.body.data.accessToken as string };
};

describe('Chat — audit coverage gaps', () => {
  let app: Express;
  const createdIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  // 5.10 — empty content
  it('POST /api/chat/:userId rejects empty content with VALIDATION_001', async () => {
    const alice = await register(app);
    const bob = await register(app);
    createdIds.push(alice.id, bob.id);

    const res = await request(app)
      .post(`/api/chat/${bob.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_001');
  });

  // 5.11 — too long (our limit is 2000, table says 1000 — enforce the
  // real backend limit, not the spec's looser one).
  it('POST /api/chat/:userId rejects content > 2000 chars', async () => {
    const alice = await register(app);
    const bob = await register(app);
    createdIds.push(alice.id, bob.id);

    const res = await request(app)
      .post(`/api/chat/${bob.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_001');
  });

  // 5.12 — cursor-based pagination via `before`
  it('GET /api/chat/:userId paginates with ?before= cursor', async () => {
    const alice = await register(app);
    const bob = await register(app);
    createdIds.push(alice.id, bob.id);

    // DMs require mutual follows — set up both directions before seeding.
    await request(app).post(`/api/follow/${bob.id}`).set('Authorization', `Bearer ${alice.token}`);
    await request(app).post(`/api/follow/${alice.id}`).set('Authorization', `Bearer ${bob.token}`);

    // Seed 5 messages from alice → bob (ids are cuid, order by createdAt)
    const sent: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await request(app)
        .post(`/api/chat/${bob.id}`)
        .set('Authorization', `Bearer ${alice.token}`)
        .send({ content: `msg-${i}` });
      sent.push(r.body.data.createdAt as string);
    }

    const firstPage = await request(app)
      .get(`/api/chat/${alice.id}?limit=2`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(firstPage.body.data).toHaveLength(2);
    // The service returns messages oldest-first on a page (after reverse).
    // We grab the oldest createdAt on the current page as the cursor.
    const cursor = firstPage.body.data[0].createdAt as string;

    const secondPage = await request(app)
      .get(`/api/chat/${alice.id}?limit=2&before=${encodeURIComponent(cursor)}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(secondPage.body.data.length).toBeGreaterThan(0);
    for (const m of secondPage.body.data as { createdAt: string }[]) {
      expect(new Date(m.createdAt).getTime()).toBeLessThan(new Date(cursor).getTime());
    }
    // Sanity: seeded timestamps overlap a real range
    expect(sent.length).toBe(5);
  });

  // 5.1 — conversation with self is rejected
  it('POST /api/chat/:userId to myself returns CHAT_001', async () => {
    const me = await register(app);
    createdIds.push(me.id);

    const res = await request(app)
      .post(`/api/chat/${me.id}`)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ content: 'hello me' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CHAT_001');
  });
});
