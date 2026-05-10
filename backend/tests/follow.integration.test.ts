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
  const username = `f_${rand()}`;
  const email = `${username}@test.local`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, email, password: 'test-password-123' });
  return {
    id: res.body.data.user.id as string,
    username,
    token: res.body.data.accessToken as string,
  };
};

describe('Follow integration', () => {
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

  it('follow → followers list → unfollow round-trip', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    createdIds.push(alice.id, bob.id);

    // Alice follows Bob
    const follow = await request(app)
      .post(`/api/follow/${bob.id}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(follow.status).toBe(200);
    expect(follow.body.data.following).toBe(true);

    // Duplicate follow is idempotent, still 200
    const again = await request(app)
      .post(`/api/follow/${bob.id}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(again.status).toBe(200);

    // Bob sees Alice in his followers
    const bobFollowers = await request(app)
      .get('/api/follow/followers')
      .set('Authorization', `Bearer ${bob.token}`);
    expect(bobFollowers.status).toBe(200);
    expect(bobFollowers.body.data.map((u: { id: string }) => u.id)).toContain(alice.id);

    // Alice sees Bob in her following list
    const aliceFollowing = await request(app)
      .get('/api/follow/following')
      .set('Authorization', `Bearer ${alice.token}`);
    expect(aliceFollowing.body.data.map((u: { id: string }) => u.id)).toContain(bob.id);

    // Alice cannot follow herself
    const selfFollow = await request(app)
      .post(`/api/follow/${alice.id}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(selfFollow.status).toBe(403);
    expect(selfFollow.body.error.code).toBe('USER_003');

    // Unfollow
    const unfollow = await request(app)
      .delete(`/api/follow/${bob.id}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(unfollow.status).toBe(200);
    expect(unfollow.body.data.following).toBe(false);
  });
});
