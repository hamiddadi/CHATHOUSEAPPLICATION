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
  const u = `cr_${rand()}`;
  const r = await request(app)
    .post('/api/auth/register')
    .send({ username: u, email: `${u}@test.local`, password: 'test-password-123' });
  return { id: r.body.data.user.id as string, token: r.body.data.accessToken as string };
};

describe('CreateRoom — co-hosts + topics', () => {
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

  it('creates a room with co-hosts seated as SPEAKER + fires ROOM_INVITE on each', async () => {
    const host = await register(app);
    const co1 = await register(app);
    const co2 = await register(app);
    createdUsers.push(host.id, co1.id, co2.id);

    const res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        title: 'Co-hosted launch',
        topics: ['tech', 'design'],
        // Include the host id to confirm it's stripped before insert.
        coHostIds: [co1.id, co2.id, host.id],
      });
    expect(res.status).toBe(201);
    const roomId = res.body.data.id as string;
    createdRooms.push(roomId);

    expect(res.body.data.topics).toEqual(['tech', 'design']);

    // Both co-hosts are now SPEAKER participants.
    const participants = await prisma.participant.findMany({
      where: { roomId, leftAt: null },
      select: { userId: true, role: true },
    });
    const byUser = Object.fromEntries(participants.map(p => [p.userId, p.role]));
    expect(byUser[host.id]).toBe('HOST');
    expect(byUser[co1.id]).toBe('SPEAKER');
    expect(byUser[co2.id]).toBe('SPEAKER');

    // Each co-host received a ROOM_INVITE notification targeting this room.
    await new Promise(r => setTimeout(r, 50));
    const invites = await prisma.notification.findMany({
      where: { userId: { in: [co1.id, co2.id] }, type: 'ROOM_INVITE' },
    });
    expect(invites.length).toBeGreaterThanOrEqual(2);
    expect(invites.every(n => (n.data as { roomId?: string } | null)?.roomId === roomId)).toBe(
      true,
    );
  });

  it('validation: coHostIds containing "" is rejected', async () => {
    const host = await register(app);
    createdUsers.push(host.id);
    const res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Empty id', coHostIds: [''] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_001');
  });

  it('validation: topics cap at 5, coHostIds cap at 5', async () => {
    const host = await register(app);
    createdUsers.push(host.id);

    const tooManyTopics = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        title: 'Too many tags',
        topics: ['a', 'b', 'c', 'd', 'e', 'f'],
      });
    expect(tooManyTopics.status).toBe(400);
    expect(tooManyTopics.body.error.code).toBe('VALIDATION_001');

    const tooManyCoHosts = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        title: 'Huge cohost list',
        coHostIds: Array.from({ length: 6 }, (_, i) => `u${i}`),
      });
    expect(tooManyCoHosts.status).toBe(400);
    expect(tooManyCoHosts.body.error.code).toBe('VALIDATION_001');
  });

  it('unknown co-host ids are silently pruned — room creation still succeeds', async () => {
    const host = await register(app);
    const real = await register(app);
    createdUsers.push(host.id, real.id);

    const res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        title: 'Ghost cohost',
        coHostIds: [real.id, 'cm_nonexistent_id'],
      });
    expect(res.status).toBe(201);
    const roomId = res.body.data.id as string;
    createdRooms.push(roomId);

    const participants = await prisma.participant.findMany({
      where: { roomId, leftAt: null },
      select: { userId: true },
    });
    const ids = participants.map(p => p.userId);
    expect(ids).toContain(real.id);
    expect(ids).not.toContain('cm_nonexistent_id');
  });

  it('scheduled room with co-hosts: no participants seated yet, but invites fire', async () => {
    const host = await register(app);
    const co = await register(app);
    createdUsers.push(host.id, co.id);

    const when = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        title: 'Scheduled with cohost',
        scheduledFor: when,
        coHostIds: [co.id],
      });
    expect(res.status).toBe(201);
    const roomId = res.body.data.id as string;
    createdRooms.push(roomId);

    const participants = await prisma.participant.findMany({
      where: { roomId, leftAt: null },
    });
    expect(participants).toHaveLength(0);

    await new Promise(r => setTimeout(r, 50));
    const invite = await prisma.notification.findFirst({
      where: { userId: co.id, type: 'ROOM_INVITE' },
    });
    expect(invite).toBeTruthy();
  });

  it('feed scoring: structured topics match ranks a room above one with no match', async () => {
    const viewer = await register(app);
    const host = await register(app);
    createdUsers.push(viewer.id, host.id);

    await request(app)
      .patch('/api/users/me/interests')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ interests: ['music'] });

    const offTopic = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Gardening', topics: ['plants'] });
    createdRooms.push(offTopic.body.data.id);

    const onTopic = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Nothing to see here', topics: ['music'] });
    createdRooms.push(onTopic.body.data.id);

    const feed = await request(app)
      .get('/api/rooms/feed')
      .set('Authorization', `Bearer ${viewer.token}`);
    const onIdx = feed.body.data.findIndex((r: { id: string }) => r.id === onTopic.body.data.id);
    const offIdx = feed.body.data.findIndex((r: { id: string }) => r.id === offTopic.body.data.id);
    expect(onIdx).toBeLessThan(offIdx);
  });
});
