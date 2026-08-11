import request from 'supertest';
import type { Express } from 'express';
import { Prisma } from '@prisma/client';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse_test?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/* eslint-disable @typescript-eslint/no-require-imports */
const { createApp } = require('../src/app') as typeof import('../src/app');
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { connectRedis, disconnectRedis } =
  require('../src/config/redis') as typeof import('../src/config/redis');
const { mediaService } =
  require('../src/modules/media/media.service') as typeof import('../src/modules/media/media.service');
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

const makeMutualFollows = async (
  app: Express,
  a: { id: string; token: string },
  b: { id: string; token: string },
) => {
  await request(app).post(`/api/follow/${b.id}`).set('Authorization', `Bearer ${a.token}`);
  await request(app).post(`/api/follow/${a.id}`).set('Authorization', `Bearer ${b.token}`);
};

describe('Transactional idempotency under retries and concurrent devices', () => {
  let app: Express;
  const userIds: string[] = [];
  const roomIds: string[] = [];
  const conversationIds: string[] = [];
  const clubIds: string[] = [];
  const outboxAggregateIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    if (outboxAggregateIds.length > 0) {
      await prisma.outboxEvent.deleteMany({
        where: { aggregateId: { in: outboxAggregateIds } },
      });
    }
    for (const id of roomIds) {
      await prisma.room.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of conversationIds) {
      await prisma.conversation.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of clubIds) {
      await prisma.club.delete({ where: { id } }).catch(() => undefined);
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

  it('replays concurrent club creation exactly once and binds the key to its payload', async () => {
    const owner = await register(app);
    userIds.push(owner.id);
    const idempotencyKey = key('club');
    const payload = {
      name: `Idempotent club ${rand()} ${rand()}`,
      description: 'Created once across two devices',
      privacy: 'OPEN',
    };

    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app)
          .post('/api/clubs')
          .set('Authorization', `Bearer ${owner.token}`)
          .set('Idempotency-Key', idempotencyKey)
          .send(payload),
      ),
    );

    expect(responses.map(response => response.status)).toEqual([201, 201]);
    expect(responses[1]?.body.data.id).toBe(responses[0]?.body.data.id);
    const clubId = responses[0]?.body.data.id as string;
    clubIds.push(clubId);
    expect(await prisma.club.count({ where: { ownerId: owner.id, name: payload.name } })).toBe(1);
    expect(await prisma.clubMember.count({ where: { clubId, userId: owner.id } })).toBe(1);

    const conflict = await request(app)
      .post('/api/clubs')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ ...payload, description: 'Different payload' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_001');
  });

  it('serializes distinct club creates so concurrent requests cannot exceed the owner quota', async () => {
    const owner = await register(app);
    userIds.push(owner.id);

    for (let index = 0; index < 2; index += 1) {
      const response = await request(app)
        .post('/api/clubs')
        .set('Authorization', `Bearer ${owner.token}`)
        .set('Idempotency-Key', key(`club-seed-${index}`))
        .send({ name: `Quota seed ${index} ${rand()} ${rand()}`, privacy: 'OPEN' });
      expect(response.status).toBe(201);
      clubIds.push(response.body.data.id as string);
    }

    const racers = await Promise.all(
      Array.from({ length: 2 }, (_, index) =>
        request(app)
          .post('/api/clubs')
          .set('Authorization', `Bearer ${owner.token}`)
          .set('Idempotency-Key', key(`club-racer-${index}`))
          .send({ name: `Quota racer ${index} ${rand()} ${rand()}`, privacy: 'OPEN' }),
      ),
    );
    expect(racers.map(response => response.status).sort((a, b) => a - b)).toEqual([201, 403]);
    const winner = racers.find(response => response.status === 201);
    const rejected = racers.find(response => response.status === 403);
    if (!winner || !rejected)
      throw new Error('Expected one club creation winner and one rejection');
    clubIds.push(winner.body.data.id as string);
    expect(rejected.body.error.code).toBe('CLUB_006');
    expect(await prisma.club.count({ where: { ownerId: owner.id } })).toBe(3);
  });

  it('maps a concurrent global club-name collision to validation instead of a unique 500', async () => {
    const ownerA = await register(app);
    const ownerB = await register(app);
    userIds.push(ownerA.id, ownerB.id);
    const name = `Globally unique club ${rand()} ${rand()}`;

    const responses = await Promise.all(
      [ownerA, ownerB].map((owner, index) =>
        request(app)
          .post('/api/clubs')
          .set('Authorization', `Bearer ${owner.token}`)
          .set('Idempotency-Key', key(`club-name-${index}`))
          .send({ name, privacy: 'OPEN' }),
      ),
    );

    expect(responses.map(response => response.status).sort((a, b) => a - b)).toEqual([201, 400]);
    const winner = responses.find(response => response.status === 201);
    const rejected = responses.find(response => response.status === 400);
    if (!winner || !rejected) throw new Error('Expected one unique name winner and one rejection');
    clubIds.push(winner.body.data.id as string);
    expect(rejected.body.error.code).toBe('VALIDATION_001');
    expect(await prisma.club.count({ where: { name } })).toBe(1);
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
    const textMessageId = message.body.data.id as string;
    outboxAggregateIds.push(textMessageId);
    expect(
      await prisma.notification.count({
        where: { targetId: textMessageId, type: 'NEW_MESSAGE' },
      }),
    ).toBe(2);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: textMessageId } })).toBe(3);

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

    const voice = await mediaService.store({
      ownerId: owner.id,
      kind: 'VOICE',
      extension: 'wav',
      mimeType: 'audio/wav',
      body: Buffer.from('RIFF-idempotent-group-voice-WAVE'),
      requestOrigin: 'http://localhost',
    });
    const voiceKey = key('group-voice');
    const voicePayload = { audioUrl: voice.url, durationMs: 3_500 };
    const voiceFirst = await request(app)
      .post(`/api/groups/${conversationId}/voice`)
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', voiceKey)
      .send(voicePayload);
    expect(voiceFirst.status).toBe(201);
    outboxAggregateIds.push(voiceFirst.body.data.id as string);
    expect(
      await prisma.notification.count({
        where: { targetId: voiceFirst.body.data.id as string, type: 'NEW_MESSAGE' },
      }),
    ).toBe(3);
    expect(
      await prisma.outboxEvent.count({
        where: { aggregateId: voiceFirst.body.data.id as string },
      }),
    ).toBe(4);
    await expect(
      prisma.groupMessage.findUnique({
        where: { id: voiceFirst.body.data.id as string },
        select: { mediaObjectId: true },
      }),
    ).resolves.toEqual({ mediaObjectId: voice.id });

    // A replay resolves the already-created message before media validation.
    // This remains exact even if account cleanup removed the original object.
    await mediaService.deleteAllForUser(owner.id);
    await prisma.mediaObject.delete({ where: { id: voice.id } });
    const voiceReplay = await request(app)
      .post(`/api/groups/${conversationId}/voice`)
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', voiceKey)
      .send(voicePayload);
    expect(voiceReplay.status).toBe(201);
    expect(voiceReplay.body.data.id).toBe(voiceFirst.body.data.id);
    expect(
      await prisma.groupMessage.count({
        where: { conversationId, senderId: owner.id, kind: 'VOICE' },
      }),
    ).toBe(1);
  });

  it('revalidates group membership after a concurrent removal commits', async () => {
    const owner = await register(app);
    const sender = await register(app);
    const other = await register(app);
    userIds.push(owner.id, sender.id, other.id);
    await Promise.all(
      [sender.id, other.id].map(targetId =>
        request(app).post(`/api/follow/${targetId}`).set('Authorization', `Bearer ${owner.token}`),
      ),
    );
    const created = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', key('group-removal-create'))
      .send({ memberIds: [sender.id, other.id], title: `Removal race ${rand()}` });
    expect(created.status).toBe(201);
    const conversationId = created.body.data.id as string;
    conversationIds.push(conversationId);

    let signalLocked!: () => void;
    let releaseLock!: () => void;
    const locked = new Promise<void>(resolve => (signalLocked = resolve));
    const release = new Promise<void>(resolve => (releaseLock = resolve));
    const remover = prisma.$transaction(async tx => {
      await tx.$queryRaw`
        SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
      signalLocked();
      await release;
      await tx.conversationMember.deleteMany({
        where: { conversationId, userId: sender.id },
      });
    });
    await locked;

    const content = `must not cross removal ${rand()}`;
    const sending = request(app)
      .post(`/api/groups/${conversationId}/messages`)
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', key('group-removal-send'))
      .send({ content })
      .then(response => response);
    await new Promise(resolve => setTimeout(resolve, 100));
    releaseLock();
    await remover;
    const response = await sending;

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('GROUP_002');
    expect(
      await prisma.groupMessage.count({
        where: { conversationId, senderId: sender.id, content },
      }),
    ).toBe(0);
  });

  it('creates one text DM for concurrent retries and rejects a conflicting payload', async () => {
    const sender = await register(app);
    const receiver = await register(app);
    userIds.push(sender.id, receiver.id);
    await makeMutualFollows(app, sender, receiver);

    const idempotencyKey = key('dm-text');
    const content = `exactly once ${rand()}`;
    const notificationsBefore = await prisma.notification.count({
      where: { userId: receiver.id, type: 'NEW_MESSAGE' },
    });
    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app)
          .post(`/api/chat/${receiver.id}`)
          .set('Authorization', `Bearer ${sender.token}`)
          .set('Idempotency-Key', idempotencyKey)
          .send({ content }),
      ),
    );

    expect(responses.map(response => response.status)).toEqual([201, 201]);
    expect(responses[1]?.body.data.id).toBe(responses[0]?.body.data.id);
    expect(
      await prisma.message.count({
        where: { senderId: sender.id, receiverId: receiver.id, content },
      }),
    ).toBe(1);
    expect(
      await prisma.notification.count({ where: { userId: receiver.id, type: 'NEW_MESSAGE' } }),
    ).toBe(notificationsBefore + 1);
    const messageId = responses[0]?.body.data.id as string;
    outboxAggregateIds.push(messageId);
    expect(
      await prisma.notification.findFirst({
        where: {
          userId: receiver.id,
          actorId: sender.id,
          targetId: messageId,
          targetType: 'message',
          type: 'NEW_MESSAGE',
        },
      }),
    ).not.toBeNull();
    expect(await prisma.outboxEvent.count({ where: { aggregateId: messageId } })).toBe(2);

    const conflict = await request(app)
      .post(`/api/chat/${receiver.id}`)
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ content: `${content} changed` });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_001');
  });

  it('revalidates the DM block graph under the same locks as message insertion', async () => {
    const sender = await register(app);
    const receiver = await register(app);
    userIds.push(sender.id, receiver.id);
    await makeMutualFollows(app, sender, receiver);

    let signalLocked!: () => void;
    let releaseLock!: () => void;
    const locked = new Promise<void>(resolve => (signalLocked = resolve));
    const release = new Promise<void>(resolve => (releaseLock = resolve));
    const ids = [sender.id, receiver.id].sort();
    const blocker = prisma.$transaction(async tx => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
      );
      signalLocked();
      await release;
      await tx.block.create({ data: { blockerId: receiver.id, blockedId: sender.id } });
      await tx.follow.deleteMany({
        where: {
          OR: [
            { followerId: sender.id, followingId: receiver.id },
            { followerId: receiver.id, followingId: sender.id },
          ],
        },
      });
    });
    await locked;

    const content = `must not cross block ${rand()}`;
    const sending = request(app)
      .post(`/api/chat/${receiver.id}`)
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', key('dm-block-race'))
      .send({ content })
      .then(response => response);
    // Give the request time to reach the relationship lock held above. The
    // transaction then commits the block first; the send must re-read it.
    await new Promise(resolve => setTimeout(resolve, 100));
    releaseLock();
    await blocker;
    const response = await sending;

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CHAT_004');
    expect(
      await prisma.message.count({
        where: { senderId: sender.id, receiverId: receiver.id, content },
      }),
    ).toBe(0);
  });

  it('creates one voice DM for concurrent retries and binds the key across DM kinds', async () => {
    const sender = await register(app);
    const receiver = await register(app);
    userIds.push(sender.id, receiver.id);
    await makeMutualFollows(app, sender, receiver);

    const voice = await mediaService.store({
      ownerId: sender.id,
      kind: 'VOICE',
      extension: 'wav',
      mimeType: 'audio/wav',
      body: Buffer.from('RIFF-idempotent-dm-voice-WAVE'),
      requestOrigin: 'http://localhost',
    });
    const idempotencyKey = key('dm-voice');
    const payload = { audioUrl: voice.url, durationMs: 4_250 };
    const notificationsBefore = await prisma.notification.count({
      where: { userId: receiver.id, type: 'NEW_MESSAGE' },
    });
    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app)
          .post(`/api/chat/${receiver.id}/voice`)
          .set('Authorization', `Bearer ${sender.token}`)
          .set('Idempotency-Key', idempotencyKey)
          .send(payload),
      ),
    );

    expect(responses.map(response => response.status)).toEqual([201, 201]);
    expect(responses[1]?.body.data.id).toBe(responses[0]?.body.data.id);
    expect(
      await prisma.message.count({
        where: {
          senderId: sender.id,
          receiverId: receiver.id,
          kind: 'VOICE',
          audioUrl: voice.url,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.notification.count({ where: { userId: receiver.id, type: 'NEW_MESSAGE' } }),
    ).toBe(notificationsBefore + 1);
    const voiceMessageId = responses[0]?.body.data.id as string;
    outboxAggregateIds.push(voiceMessageId);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: voiceMessageId } })).toBe(2);

    const changedDuration = await request(app)
      .post(`/api/chat/${receiver.id}/voice`)
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ ...payload, durationMs: payload.durationMs + 1 });
    expect(changedDuration.status).toBe(409);
    expect(changedDuration.body.error.code).toBe('IDEMPOTENCY_001');

    // Text and voice share one peer-scoped resource namespace. `kind` is part
    // of the request hash, so a key cannot silently create one of each.
    const changedKind = await request(app)
      .post(`/api/chat/${receiver.id}`)
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ content: 'same key, different DM kind' });
    expect(changedKind.status).toBe(409);
    expect(changedKind.body.error.code).toBe('IDEMPOTENCY_001');

    await mediaService.deleteAllForUser(sender.id);
    await prisma.mediaObject.delete({ where: { id: voice.id } });
    const replayWithoutMedia = await request(app)
      .post(`/api/chat/${receiver.id}/voice`)
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);
    expect(replayWithoutMedia.status).toBe(201);
    expect(replayWithoutMedia.body.data.id).toBe(responses[0]?.body.data.id);
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
