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
const { isActiveRoomParticipant } =
  require('../src/webrtc/roomAuthz') as typeof import('../src/webrtc/roomAuthz');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

const registerUser = async (app: Express) => {
  const username = `z_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, email: `${username}@test.local`, password: 'test-password-123' });
  return {
    id: res.body.data.user.id as string,
    token: res.body.data.accessToken as string,
  };
};

describe('isActiveRoomParticipant (RTC authz)', () => {
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

  it('host is a member from creation; outsider is not; leaver becomes non-member', async () => {
    const host = await registerUser(app);
    const outsider = await registerUser(app);
    const rejoiner = await registerUser(app);
    createdUserIds.push(host.id, outsider.id, rejoiner.id);

    const created = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Authz room' });
    const roomId = created.body.data.id as string;
    createdRoomIds.push(roomId);

    expect(await isActiveRoomParticipant(roomId, host.id)).toBe(true);
    expect(await isActiveRoomParticipant(roomId, outsider.id)).toBe(false);

    // rejoiner joins, becomes member, leaves, is no longer a member
    await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${rejoiner.token}`);
    expect(await isActiveRoomParticipant(roomId, rejoiner.id)).toBe(true);

    await request(app)
      .post(`/api/rooms/${roomId}/leave`)
      .set('Authorization', `Bearer ${rejoiner.token}`);
    expect(await isActiveRoomParticipant(roomId, rejoiner.id)).toBe(false);
  });

  it('non-existent room → non-member', async () => {
    const alice = await registerUser(app);
    createdUserIds.push(alice.id);
    expect(await isActiveRoomParticipant('room-does-not-exist', alice.id)).toBe(false);
  });
});
