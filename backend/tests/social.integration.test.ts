import request from 'supertest';
import type { Express } from 'express';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/* eslint-disable @typescript-eslint/no-require-imports */
const { createApp } = require('../src/app') as typeof import('../src/app');
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { redis, connectRedis, disconnectRedis } =
  require('../src/config/redis') as typeof import('../src/config/redis');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

const register = async (app: Express) => {
  const u = `soc_${rand()}`;
  const r = await request(app)
    .post('/api/auth/register')
    .send({ username: u, email: `${u}@test.local`, password: 'test-password-123' });
  return { id: r.body.data.user.id as string, token: r.body.data.accessToken as string };
};

describe('Social actions — wave + block + report', () => {
  let app: Express;
  const createdIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterEach(async () => {
    // Wipe the wave rate-limit bucket between tests so each scenario
    // gets a fresh hour-window to hit.
    const keys = await redis.keys('wave:*');
    if (keys.length > 0) await redis.del(keys);
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('wave: creates a WAVE notification on the target; re-wave within window → USER_005', async () => {
    const a = await register(app);
    const b = await register(app);
    createdIds.push(a.id, b.id);

    const first = await request(app)
      .post(`/api/users/${b.id}/wave`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(first.status).toBe(200);
    expect(first.body.data.waved).toBe(true);

    // Notification row landed for b.
    await new Promise(r => setTimeout(r, 50)); // notificationsService.create is fire-and-forget
    const notif = await prisma.notification.findFirst({
      where: { userId: b.id, type: 'WAVE' },
    });
    expect(notif).toBeTruthy();
    expect((notif?.data as { waverId?: string } | null)?.waverId).toBe(a.id);

    // Second wave within the hour → 429 USER_005
    const again = await request(app)
      .post(`/api/users/${b.id}/wave`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe('USER_005');
  });

  it('wave: self-wave returns USER_003', async () => {
    const a = await register(app);
    createdIds.push(a.id);
    const res = await request(app)
      .post(`/api/users/${a.id}/wave`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('USER_003');
  });

  it('block: hard-breaks the follow graph in both directions', async () => {
    const a = await register(app);
    const b = await register(app);
    createdIds.push(a.id, b.id);

    // Mutual follows first.
    await request(app).post(`/api/follow/${b.id}`).set('Authorization', `Bearer ${a.token}`);
    await request(app).post(`/api/follow/${a.id}`).set('Authorization', `Bearer ${b.token}`);

    // a blocks b.
    const res = await request(app)
      .post(`/api/users/${b.id}/block`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.blocked).toBe(true);

    // No follows in either direction remain.
    const follows = await prisma.follow.findMany({
      where: {
        OR: [
          { followerId: a.id, followingId: b.id },
          { followerId: b.id, followingId: a.id },
        ],
      },
    });
    expect(follows).toHaveLength(0);
  });

  it('block: excludes the blocked user from search (both directions)', async () => {
    const viewer = await register(app);
    const blocked = await register(app);
    createdIds.push(viewer.id, blocked.id);

    // Set a unique bio marker so the search finds them deterministically.
    const marker = `socblkzz${rand()}`;
    await prisma.user.update({
      where: { id: blocked.id },
      data: { bio: `keyword ${marker}` },
    });

    // Block, then search.
    await request(app)
      .post(`/api/users/${blocked.id}/block`)
      .set('Authorization', `Bearer ${viewer.token}`);

    const search = await request(app)
      .get(`/api/search?q=${marker}&type=users`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(search.status).toBe(200);
    const ids = (search.body.data.users as { id: string }[]).map(u => u.id);
    expect(ids).not.toContain(blocked.id);

    // And the inverse: the blocked user also doesn't see the viewer.
    await prisma.user.update({
      where: { id: viewer.id },
      data: { bio: `keyword ${marker}` },
    });
    const reverse = await request(app)
      .get(`/api/search?q=${marker}&type=users`)
      .set('Authorization', `Bearer ${blocked.token}`);
    const reverseIds = (reverse.body.data.users as { id: string }[]).map(u => u.id);
    expect(reverseIds).not.toContain(viewer.id);
  });

  it('block: can be undone via DELETE /users/:id/block', async () => {
    const a = await register(app);
    const b = await register(app);
    createdIds.push(a.id, b.id);

    await request(app).post(`/api/users/${b.id}/block`).set('Authorization', `Bearer ${a.token}`);

    const listBefore = await request(app)
      .get('/api/users/me/blocked')
      .set('Authorization', `Bearer ${a.token}`);
    expect(listBefore.body.data.map((u: { id: string }) => u.id)).toContain(b.id);

    const unblock = await request(app)
      .delete(`/api/users/${b.id}/block`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(unblock.status).toBe(200);
    expect(unblock.body.data.unblocked).toBe(true);

    const listAfter = await request(app)
      .get('/api/users/me/blocked')
      .set('Authorization', `Bearer ${a.token}`);
    expect(listAfter.body.data.map((u: { id: string }) => u.id)).not.toContain(b.id);
  });

  it('block: self-block is rejected (USER_004)', async () => {
    const a = await register(app);
    createdIds.push(a.id);
    const res = await request(app)
      .post(`/api/users/${a.id}/block`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('USER_004');
  });

  it('report: creates a moderation row; rejects invalid reason', async () => {
    const reporter = await register(app);
    const bad = await register(app);
    createdIds.push(reporter.id, bad.id);

    const ok = await request(app)
      .post(`/api/users/${bad.id}/report`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ reason: 'harassment', details: 'Repeated abusive DMs' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.reportId).toEqual(expect.any(String));

    const stored = await prisma.report.findUnique({
      where: { id: ok.body.data.reportId },
    });
    expect(stored?.reason).toBe('HARASSMENT');
    expect(stored?.reporterId).toBe(reporter.id);
    expect(stored?.reportedId).toBe(bad.id);

    const invalid = await request(app)
      .post(`/api/users/${bad.id}/report`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ reason: 'bogus' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_001');
  });
});
