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

const registerUser = async (app: Express) => {
  const username = `nt_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, email: `${username}@test.local`, password: 'test-password-123' });
  return {
    id: res.body.data.user.id as string,
    username,
    token: res.body.data.accessToken as string,
  };
};

describe('Notifications + Push integration', () => {
  let app: Express;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('following a user creates a NEW_FOLLOWER notification for them', async () => {
    const follower = await registerUser(app);
    const target = await registerUser(app);
    createdUserIds.push(follower.id, target.id);

    const res = await request(app)
      .post(`/api/follow/${target.id}`)
      .set('Authorization', `Bearer ${follower.token}`);
    expect(res.status).toBe(200);

    const list = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${target.token}`);
    expect(list.status).toBe(200);
    const follow = (list.body.data as { type: string; data?: { followerId?: string } }[]).find(
      n => n.type === 'NEW_FOLLOWER',
    );
    expect(follow).toBeTruthy();
    expect(follow?.data?.followerId).toBe(follower.id);

    // Unread count surfaces it.
    const unread = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${target.token}`);
    expect(unread.status).toBe(200);
    expect(unread.body.data.count).toBeGreaterThanOrEqual(1);

    // Re-following is idempotent — doesn't duplicate the notification.
    await request(app)
      .post(`/api/follow/${target.id}`)
      .set('Authorization', `Bearer ${follower.token}`);
    const after = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${target.token}`);
    const count = (after.body.data as { type: string; data?: { followerId?: string } }[]).filter(
      n => n.type === 'NEW_FOLLOWER' && n.data?.followerId === follower.id,
    ).length;
    expect(count).toBe(1);
  });

  it('PATCH /:id/read marks a single notification read; /read-all flushes the rest', async () => {
    const follower = await registerUser(app);
    const target = await registerUser(app);
    createdUserIds.push(follower.id, target.id);

    // Trigger a few notifications by having `follower` follow then
    // unfollow+refollow (the service no-ops on duplicates so we use
    // different actors).
    const f2 = await registerUser(app);
    createdUserIds.push(f2.id);
    await request(app)
      .post(`/api/follow/${target.id}`)
      .set('Authorization', `Bearer ${follower.token}`);
    await request(app).post(`/api/follow/${target.id}`).set('Authorization', `Bearer ${f2.token}`);

    const list = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${target.token}`);
    const first = list.body.data[0] as { id: string; isRead: boolean };
    expect(first.isRead).toBe(false);

    const readOne = await request(app)
      .patch(`/api/notifications/${first.id}/read`)
      .set('Authorization', `Bearer ${target.token}`);
    expect(readOne.status).toBe(200);
    expect(readOne.body.data.read).toBe(true);

    const beforeAll = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${target.token}`);
    const afterOne = beforeAll.body.data.count;

    const readAll = await request(app)
      .patch('/api/notifications/read-all')
      .set('Authorization', `Bearer ${target.token}`);
    expect(readAll.status).toBe(200);
    expect(readAll.body.data.updated).toBe(afterOne);

    const finalUnread = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${target.token}`);
    expect(finalUnread.body.data.count).toBe(0);
  });

  it('PATCH /:id/read on a notification belonging to someone else returns NOT_FOUND_001', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    createdUserIds.push(a.id, b.id);

    await request(app).post(`/api/follow/${a.id}`).set('Authorization', `Bearer ${b.token}`);

    const list = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${a.token}`);
    const notifId = list.body.data[0].id as string;

    // `b` tries to mark `a`'s notification read.
    const res = await request(app)
      .patch(`/api/notifications/${notifId}/read`)
      .set('Authorization', `Bearer ${b.token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND_001');
  });

  it('POST /api/push/register stores a token, unregister removes it', async () => {
    const u = await registerUser(app);
    createdUserIds.push(u.id);

    const tok = `ExponentPushToken[${rand()}]`;
    const reg = await request(app)
      .post('/api/push/register')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ token: tok, platform: 'expo' });
    expect(reg.status).toBe(200);
    expect(reg.body.data.registered).toBe(true);

    const rows = await prisma.pushToken.findMany({ where: { userId: u.id } });
    expect(rows.some(r => r.token === tok)).toBe(true);

    // Re-register (same token) upserts — no dup.
    await request(app)
      .post('/api/push/register')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ token: tok, platform: 'expo' });
    const afterReupsert = await prisma.pushToken.findMany({ where: { userId: u.id, token: tok } });
    expect(afterReupsert).toHaveLength(1);

    const unreg = await request(app)
      .post('/api/push/unregister')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ token: tok });
    expect(unreg.status).toBe(200);
    const gone = await prisma.pushToken.findMany({ where: { userId: u.id, token: tok } });
    expect(gone).toHaveLength(0);
  });

  it('push dispatch stub: creating a notification for a user with a registered token does not throw', async () => {
    const u = await registerUser(app);
    createdUserIds.push(u.id);

    await request(app)
      .post('/api/push/register')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ token: `ExponentPushToken[${rand()}]`, platform: 'expo' });

    // Triggering a follow fires the notification → push dispatcher.
    const other = await registerUser(app);
    createdUserIds.push(other.id);
    const res = await request(app)
      .post(`/api/follow/${u.id}`)
      .set('Authorization', `Bearer ${other.token}`);
    expect(res.status).toBe(200);
    // The actual push is a stub (logs only). Success here means the
    // notification-create path completed without the push error
    // propagating.
  });

  it('DELETE /:id removes a single notification', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    createdUserIds.push(a.id, b.id);

    await request(app).post(`/api/follow/${a.id}`).set('Authorization', `Bearer ${b.token}`);

    const list = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${a.token}`);
    const id = list.body.data[0].id as string;

    const del = await request(app)
      .delete(`/api/notifications/${id}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(del.status).toBe(200);

    const after = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${a.token}`);
    expect(after.body.data.some((n: { id: string }) => n.id === id)).toBe(false);
  });
});
