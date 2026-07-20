import request from 'supertest';
import type { Express } from 'express';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse_test?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/* eslint-disable @typescript-eslint/no-require-imports */
const { createApp } = require('../src/app') as typeof import('../src/app');
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { connectRedis, disconnectRedis } =
  require('../src/config/redis') as typeof import('../src/config/redis');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);
const key = (scope: string) => `${scope}-${rand()}-${rand()}`;

const register = async (app: Express) => {
  const username = `idem_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      username,
      email: `${username}@test.local`,
      password: 'test-password-123',
    });
  expect(res.status).toBe(201);
  return {
    id: res.body.data.user.id as string,
    token: res.body.data.accessToken as string,
  };
};

describe('Transactional idempotency under retries and concurrent devices', () => {
  let app: Express;
  const userIds: string[] = [];
  const roomIds: string[] = [];
  const conversationIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    for (const id of roomIds) {
      await prisma.room.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of conversationIds) {
      await prisma.conversation.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of userIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('replays room creation and rejects reuse of the key with a different payload', async () => {
    const host = await register(app);
    userIds.push(host.id);
    const idempotencyKey = key('room');
    const payload = { title: `Idempotent room ${rand()}` };

    const first = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);
    const replay = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body.data.id).toBe(first.body.data.id);
    roomIds.push(first.body.data.id as string);
    expect(
      await prisma.room.count({
        where: { hostId: host.id, title: payload.title },
      }),
    ).toBe(1);

    const conflictingReplay = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ title: `${payload.title} changed` });
    expect(conflictingReplay.status).toBe(409);
    expect(conflictingReplay.body.error.code).toBe('IDEMPOTENCY_001');
  });

  it('serializes concurrent room join/leave retries without count drift', async () => {
    const host = await register(app);
    const listener = await register(app);
    userIds.push(host.id, listener.id);

    const created = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: `Concurrent room ${rand()}` });
    expect(created.status).toBe(201);
    const roomId = created.body.data.id as string;
    roomIds.push(roomId);

    const joins = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app)
          .post(`/api/rooms/${roomId}/join`)
          .set('Authorization', `Bearer ${listener.token}`),
      ),
    );
    expect(joins.map(res => res.status)).toEqual([200, 200]);
    expect(
      await prisma.participant.count({
        where: { roomId, userId: listener.id, leftAt: null },
      }),
    ).toBe(1);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).participantCount).toBe(
      2,
    );

    const leaves = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app)
          .post(`/api/rooms/${roomId}/leave`)
          .set('Authorization', `Bearer ${listener.token}`),
      ),
    );
    expect(leaves.map(res => res.status)).toEqual([200, 200]);
    expect(
      await prisma.participant.count({
        where: { roomId, userId: listener.id, leftAt: null },
      }),
    ).toBe(0);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).participantCount).toBe(
      1,
    );
  });

  it('replays group creation/messages/member admission exactly once', async () => {
    const owner = await register(app);
    const memberA = await register(app);
    const memberB = await register(app);
    userIds.push(owner.id, memberA.id, memberB.id);

    await Promise.all(
      [memberA.id, memberB.id].map(targetId =>
        request(app).post(`/api/follow/${targetId}`).set('Authorization', `Bearer ${owner.token}`),
      ),
    );

    const createKey = key('group');
    const createPayload = {
      title: `Idempotent group ${rand()}`,
      memberIds: [memberA.id, memberB.id],
    };
    const createResponses = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app)
          .post('/api/groups')
          .set('Authorization', `Bearer ${owner.token}`)
          .set('Idempotency-Key', createKey)
          .send(createPayload),
      ),
    );
    const first = createResponses[0];
    const replay = createResponses[1];
    if (!first || !replay) {
      throw new Error('Expected two concurrent group creation responses');
    }
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body.data.id).toBe(first.body.data.id);
    const conversationId = first.body.data.id as string;
    conversationIds.push(conversationId);

    const messageKey = key('group-message');
    const messageResponses = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app)
          .post(`/api/groups/${conversationId}/messages`)
          .set('Authorization', `Bearer ${owner.token}`)
          .set('Idempotency-Key', messageKey)
          .send({ content: 'exactly once' }),
      ),
    );
    const message = messageResponses[0];
    const messageReplay = messageResponses[1];
    if (!message || !messageReplay) {
      throw new Error('Expected two concurrent group message responses');
    }
    expect(message.status).toBe(201);
    expect(messageReplay.status).toBe(201);
    expect(messageReplay.body.data.id).toBe(message.body.data.id);
    expect(
      await prisma.groupMessage.count({
        where: { conversationId, senderId: owner.id, content: 'exactly once' },
      }),
    ).toBe(1);

    const memberC = await register(app);
    userIds.push(memberC.id);
    await request(app)
      .post(`/api/follow/${memberC.id}`)
      .set('Authorization', `Bearer ${owner.token}`);

    const addKey = key('group-member');
    const additions = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app)
          .post(`/api/groups/${conversationId}/members`)
          .set('Authorization', `Bearer ${owner.token}`)
          .set('Idempotency-Key', addKey)
          .send({ userIds: [memberC.id] }),
      ),
    );
    expect(additions.map(response => response.status)).toEqual([200, 200]);
    expect(
      await prisma.conversationMember.count({
        where: { conversationId, userId: memberC.id },
      }),
    ).toBe(1);
  });

  it('makes concurrent follow/unfollow retries naturally idempotent with exact counters', async () => {
    const follower = await register(app);
    const target = await register(app);
    userIds.push(follower.id, target.id);

    const follows = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app)
          .post(`/api/follow/${target.id}`)
          .set('Authorization', `Bearer ${follower.token}`),
      ),
    );
    expect(follows.map(res => res.status)).toEqual([200, 200]);
    expect(
      await prisma.follow.count({
        where: {
          followerId: follower.id,
          followingId: target.id,
          status: 'ACCEPTED',
        },
      }),
    ).toBe(1);
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: follower.id },
        select: { followingCount: true },
      }),
    ).toEqual({ followingCount: 1 });
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: target.id },
        select: { followerCount: true },
      }),
    ).toEqual({ followerCount: 1 });

    const unfollows = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app)
          .delete(`/api/follow/${target.id}`)
          .set('Authorization', `Bearer ${follower.token}`),
      ),
    );
    expect(unfollows.map(res => res.status)).toEqual([200, 200]);
    expect(
      await prisma.follow.count({
        where: { followerId: follower.id, followingId: target.id },
      }),
    ).toBe(0);
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: follower.id },
        select: { followingCount: true },
      }),
    ).toEqual({ followingCount: 0 });
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: target.id },
        select: { followerCount: true },
      }),
    ).toEqual({ followerCount: 0 });
  });
});
