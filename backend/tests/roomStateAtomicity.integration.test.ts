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

const rand = (): string => Math.random().toString(36).slice(2, 10);

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('Room state authorization is atomic with room writes', () => {
  let app: Express;
  const userIds: string[] = [];
  const roomIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    for (const roomId of roomIds) {
      await prisma.room.delete({ where: { id: roomId } }).catch(() => undefined);
    }
    for (const userId of userIds) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  const register = async () => {
    const username = `atomic_${rand()}`;
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        username,
        email: `${username}@test.local`,
        password: 'test-password-123',
      });
    expect(response.status).toBe(201);
    const user = {
      id: response.body.data.user.id as string,
      token: response.body.data.accessToken as string,
    };
    userIds.push(user.id);
    return user;
  };

  const createRoom = async (hostToken: string): Promise<string> => {
    const response = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${hostToken}`)
      .send({ title: `Atomic room ${rand()}` });
    expect(response.status).toBe(201);
    const roomId = response.body.data.id as string;
    roomIds.push(roomId);
    return roomId;
  };

  it('rejects a message that resumes after chat was disabled', async () => {
    const host = await register();
    const roomId = await createRoom(host.token);
    const stateCommitted = deferred();
    const releaseTransaction = deferred();

    const disableChat = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
      await tx.room.update({ where: { id: roomId }, data: { chatEnabled: false } });
      stateCommitted.resolve();
      await releaseTransaction.promise;
    });
    await stateCommitted.promise;

    const pendingMessage = request(app)
      .post(`/api/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${host.token}`)
      .set('Idempotency-Key', `disabled-chat-${rand()}-${rand()}`)
      .send({ content: 'Must not be persisted after chat disable' })
      .then(response => response);

    await new Promise<void>(resolve => setTimeout(resolve, 50));
    releaseTransaction.resolve();
    await disableChat;
    const response = await pendingMessage;

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ROOM_006');
    expect(
      await prisma.roomChatMessage.count({
        where: { roomId, content: 'Must not be persisted after chat disable' },
      }),
    ).toBe(0);
  });

  it('rejects a reaction that resumes after the participant left', async () => {
    const host = await register();
    const listener = await register();
    const roomId = await createRoom(host.token);
    const joined = await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${listener.token}`);
    expect(joined.status).toBe(200);

    const stateCommitted = deferred();
    const releaseTransaction = deferred();
    const leaveParticipant = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
      await tx.participant.update({
        where: { userId_roomId: { userId: listener.id, roomId } },
        data: { leftAt: new Date() },
      });
      stateCommitted.resolve();
      await releaseTransaction.promise;
    });
    await stateCommitted.promise;

    const pendingReaction = request(app)
      .post(`/api/rooms/${roomId}/reactions`)
      .set('Authorization', `Bearer ${listener.token}`)
      .set('Idempotency-Key', `left-reaction-${rand()}-${rand()}`)
      .send({ emoji: '👋' })
      .then(response => response);

    await new Promise<void>(resolve => setTimeout(resolve, 50));
    releaseTransaction.resolve();
    await leaveParticipant;
    const response = await pendingReaction;

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ROOM_005');
    expect(
      await prisma.roomReaction.count({
        where: { roomId, userId: listener.id, emoji: '👋' },
      }),
    ).toBe(0);
  });
});
