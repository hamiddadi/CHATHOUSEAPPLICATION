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
  const username = `r_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, email: `${username}@test.local`, password: 'test-password-123' });
  return {
    id: res.body.data.user.id as string,
    username,
    token: res.body.data.accessToken as string,
  };
};

describe('Rooms integration', () => {
  let app: Express;
  const createdUserIds: string[] = [];
  const createdRoomIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    for (const id of createdRoomIds) {
      await prisma.room.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdUserIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('host can create, a listener can join, leave, and the host can end', async () => {
    const host = await registerUser(app);
    const listener = await registerUser(app);
    createdUserIds.push(host.id, listener.id);

    const create = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Phase 3 smoke room', maxSpeakers: 4 });
    expect(create.status).toBe(201);
    const roomId = create.body.data.id as string;
    createdRoomIds.push(roomId);
    expect(create.body.data.participants).toHaveLength(1); // host auto-added
    expect(create.body.data.participants[0].user.id).toBe(host.id);

    const list = await request(app).get('/api/rooms').set('Authorization', `Bearer ${host.token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.some((r: { id: string }) => r.id === roomId)).toBe(true);

    const join = await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${listener.token}`);
    expect(join.status).toBe(200);
    expect(join.body.data.participants).toHaveLength(2);

    const leave = await request(app)
      .post(`/api/rooms/${roomId}/leave`)
      .set('Authorization', `Bearer ${listener.token}`);
    expect(leave.status).toBe(200);

    const nonHostEnd = await request(app)
      .delete(`/api/rooms/${roomId}`)
      .set('Authorization', `Bearer ${listener.token}`);
    expect(nonHostEnd.status).toBe(403);
    expect(nonHostEnd.body.error.code).toBe('ROOM_003');

    const end = await request(app)
      .delete(`/api/rooms/${roomId}`)
      .set('Authorization', `Bearer ${host.token}`);
    expect(end.status).toBe(200);

    const afterEnd = await request(app)
      .get(`/api/rooms/${roomId}`)
      .set('Authorization', `Bearer ${host.token}`);
    expect(afterEnd.body.data.isLive).toBe(false);
    expect(afterEnd.body.data.endedAt).toBeTruthy();
  });

  it('host can promote a listener to SPEAKER; unknown user returns USER_001', async () => {
    const host = await registerUser(app);
    const listener = await registerUser(app);
    createdUserIds.push(host.id, listener.id);

    const create = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Role room' });
    const roomId = create.body.data.id as string;
    createdRoomIds.push(roomId);

    await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${listener.token}`);

    const promote = await request(app)
      .patch(`/api/rooms/${roomId}/role`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ userId: listener.id, role: 'SPEAKER' });
    expect(promote.status).toBe(200);
    expect(promote.body.data.role).toBe('SPEAKER');

    const nobody = await request(app)
      .patch(`/api/rooms/${roomId}/role`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ userId: 'non-existent', role: 'SPEAKER' });
    expect(nobody.status).toBe(404);
    expect(nobody.body.error.code).toBe('USER_001');
  });
});
