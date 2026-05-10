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
  const u = `r_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: u, email: `${u}@test.local`, password: 'test-password-123' });
  return { id: res.body.data.user.id as string, token: res.body.data.accessToken as string };
};

describe('Rooms — audit coverage gaps', () => {
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

  // 3.4 — Détail d'une room
  it('GET /api/rooms/:id returns the room with its participants', async () => {
    const host = await register(app);
    createdUserIds.push(host.id);

    const created = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Detail room', topic: 'qa' });
    const roomId = created.body.data.id as string;
    createdRoomIds.push(roomId);

    const res = await request(app)
      .get(`/api/rooms/${roomId}`)
      .set('Authorization', `Bearer ${host.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(roomId);
    expect(res.body.data.isLive).toBe(true);
    expect(res.body.data.host.id).toBe(host.id);
    expect(res.body.data.participants).toHaveLength(1);
  });

  // 3.14 — Room inexistante
  it('GET /api/rooms/:id returns 404 ROOM_001 for an unknown id', async () => {
    const user = await register(app);
    createdUserIds.push(user.id);

    const res = await request(app)
      .get('/api/rooms/does-not-exist')
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROOM_001');
  });

  // 3.10 — Mute/Unmute soi-même (REST)
  it('PATCH /api/rooms/:id/mute toggles my own isMuted', async () => {
    const host = await register(app);
    createdUserIds.push(host.id);

    const created = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Mute room' });
    const roomId = created.body.data.id as string;
    createdRoomIds.push(roomId);

    const mute = await request(app)
      .patch(`/api/rooms/${roomId}/mute`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ isMuted: true });
    expect(mute.status).toBe(200);
    expect(mute.body.data).toEqual({ userId: host.id, isMuted: true });

    const unmute = await request(app)
      .patch(`/api/rooms/${roomId}/mute`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ isMuted: false });
    expect(unmute.body.data.isMuted).toBe(false);
  });

  // 3.15 — Rejoindre room terminée
  it('POST /api/rooms/:id/join on an ended room returns 410 ROOM_004', async () => {
    const host = await register(app);
    const latejoin = await register(app);
    createdUserIds.push(host.id, latejoin.id);

    const created = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Ending room' });
    const roomId = created.body.data.id as string;
    createdRoomIds.push(roomId);

    await request(app).delete(`/api/rooms/${roomId}`).set('Authorization', `Bearer ${host.token}`);

    const join = await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${latejoin.token}`);
    expect(join.status).toBe(410);
    expect(join.body.error.code).toBe('ROOM_004');
  });

  // 3.3 — List only returns live, non-private rooms
  it('GET /api/rooms excludes ended and private rooms', async () => {
    const host = await register(app);
    createdUserIds.push(host.id);

    const live = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Live public' });
    const privateRoom = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Private', isPrivate: true });
    const ending = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Ended' });
    await request(app)
      .delete(`/api/rooms/${ending.body.data.id}`)
      .set('Authorization', `Bearer ${host.token}`);

    createdRoomIds.push(live.body.data.id, privateRoom.body.data.id, ending.body.data.id);

    const list = await request(app).get('/api/rooms').set('Authorization', `Bearer ${host.token}`);
    const ids: string[] = list.body.data.map((r: { id: string }) => r.id);
    expect(ids).toContain(live.body.data.id);
    expect(ids).not.toContain(privateRoom.body.data.id);
    expect(ids).not.toContain(ending.body.data.id);
  });

  // 3.2 + 4.13 — HOST auto-assigned to creator
  it('Room creator becomes HOST participant', async () => {
    const host = await register(app);
    createdUserIds.push(host.id);

    const created = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Host check' });
    const roomId = created.body.data.id as string;
    createdRoomIds.push(roomId);

    const res = await request(app)
      .get(`/api/rooms/${roomId}`)
      .set('Authorization', `Bearer ${host.token}`);
    const me = res.body.data.participants.find(
      (p: { user: { id: string } }) => p.user.id === host.id,
    );
    expect(me.role).toBe('HOST');
  });
});
