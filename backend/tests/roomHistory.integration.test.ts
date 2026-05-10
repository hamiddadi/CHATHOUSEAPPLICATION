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
  const u = `hist_${rand()}`;
  const r = await request(app)
    .post('/api/auth/register')
    .send({ username: u, email: `${u}@test.local`, password: 'test-password-123' });
  return { id: r.body.data.user.id as string, token: r.body.data.accessToken as string };
};

describe('GET /api/rooms/history/mine — MyProfile hosting history', () => {
  let app: Express;
  const createdUsers: string[] = [];
  const createdRooms: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    for (const id of createdRooms) {
      await prisma.room.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdUsers) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('returns only ended rooms I hosted, newest first; excludes live and rooms hosted by others', async () => {
    const me = await register(app);
    const other = await register(app);
    createdUsers.push(me.id, other.id);

    // I host + end 2 rooms.
    const closed1 = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${me.token}`)
      .send({ title: 'First retrospective' });
    createdRooms.push(closed1.body.data.id);
    await request(app)
      .delete(`/api/rooms/${closed1.body.data.id}`)
      .set('Authorization', `Bearer ${me.token}`);

    // Ensure the ordering timestamps actually differ — Postgres resolution
    // is sub-millisecond but back-to-back inserts can tie.
    await new Promise(r => setTimeout(r, 10));

    const closed2 = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${me.token}`)
      .send({ title: 'Second retrospective' });
    createdRooms.push(closed2.body.data.id);
    await request(app)
      .delete(`/api/rooms/${closed2.body.data.id}`)
      .set('Authorization', `Bearer ${me.token}`);

    // I also have a live room — must NOT appear in history.
    const live = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${me.token}`)
      .send({ title: 'Still live' });
    createdRooms.push(live.body.data.id);

    // Another user hosts + ends a room — also not mine.
    const theirs = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${other.token}`)
      .send({ title: 'Not mine' });
    createdRooms.push(theirs.body.data.id);
    await request(app)
      .delete(`/api/rooms/${theirs.body.data.id}`)
      .set('Authorization', `Bearer ${other.token}`);

    const res = await request(app)
      .get('/api/rooms/history/mine')
      .set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);

    const ids = res.body.data.map((r: { id: string }) => r.id) as string[];
    expect(ids).toContain(closed1.body.data.id);
    expect(ids).toContain(closed2.body.data.id);
    expect(ids).not.toContain(live.body.data.id);
    expect(ids).not.toContain(theirs.body.data.id);

    // Newest-first ordering.
    const firstIdx = ids.indexOf(closed2.body.data.id);
    const secondIdx = ids.indexOf(closed1.body.data.id);
    expect(firstIdx).toBeLessThan(secondIdx);
  });

  it('respects the limit query param (capped at 50)', async () => {
    const me = await register(app);
    createdUsers.push(me.id);

    for (let i = 0; i < 3; i++) {
      const r = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${me.token}`)
        .send({ title: `seed-${i}` });
      createdRooms.push(r.body.data.id);
      await request(app)
        .delete(`/api/rooms/${r.body.data.id}`)
        .set('Authorization', `Bearer ${me.token}`);
    }

    const res = await request(app)
      .get('/api/rooms/history/mine?limit=2')
      .set('Authorization', `Bearer ${me.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/rooms/history/mine');
    expect(res.status).toBe(401);
  });
});
