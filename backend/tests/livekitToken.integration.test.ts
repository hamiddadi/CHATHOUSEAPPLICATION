import request from 'supertest';
import type { Express } from 'express';

process.env.LIVEKIT_URL = 'ws://127.0.0.1:7880';
process.env.LIVEKIT_INTERNAL_URL = 'http://livekit:7880';
process.env.LIVEKIT_API_KEY = 'test-livekit-key';
process.env.LIVEKIT_API_SECRET = 'test-livekit-secret';
process.env.LIVEKIT_TOKEN_TTL_SECONDS = '3600';

jest.mock('livekit-server-sdk', () => {
  const state = {
    events: [] as string[],
    tokenTtls: [] as string[],
    roomServiceHosts: [] as string[],
  };

  class RoomServiceClient {
    constructor(host: string) {
      state.roomServiceHosts.push(host);
    }

    async createRoom(options: { name: string }) {
      state.events.push(`create:${options.name}`);
      return { name: options.name };
    }

    async removeParticipant() {}

    async deleteRoom(room: string) {
      state.events.push(`delete:${room}`);
    }
  }

  class AccessToken {
    private room = '';

    constructor(_apiKey: string, _apiSecret: string, options: { identity: string; ttl: string }) {
      state.tokenTtls.push(options.ttl);
    }

    addGrant(grant: { room: string }) {
      this.room = grant.room;
    }

    async toJwt() {
      state.events.push(`sign:${this.room}`);
      return 'integration-livekit-token';
    }
  }

  class EgressClient {}
  class WebhookReceiver {}
  class EncodedFileOutput {}
  class S3Upload {}
  const EgressStatus = {
    EGRESS_STARTING: 0,
    EGRESS_ACTIVE: 1,
    EGRESS_ENDING: 2,
    EGRESS_COMPLETE: 3,
    EGRESS_FAILED: 4,
    EGRESS_ABORTED: 5,
  };
  const EncodedFileType = { DEFAULT_FILETYPE: 0, MP4: 1, OGG: 2 };

  return {
    __esModule: true,
    AccessToken,
    RoomServiceClient,
    EgressClient,
    WebhookReceiver,
    EncodedFileOutput,
    S3Upload,
    EgressStatus,
    EncodedFileType,
    __livekitMock: state,
  };
});

/* eslint-disable @typescript-eslint/no-require-imports */
const { createApp } = require('../src/app') as typeof import('../src/app');
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { connectRedis, disconnectRedis } =
  require('../src/config/redis') as typeof import('../src/config/redis');
const { __livekitMock } = require('livekit-server-sdk') as {
  __livekitMock: { events: string[]; tokenTtls: string[]; roomServiceHosts: string[] };
};
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

describe('LiveKit room-token lifecycle guard', () => {
  let app: Express;
  const userIds: string[] = [];
  const roomIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    for (const id of roomIds) {
      await prisma.room.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of userIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('allows a live participant, then rejects the same stale participant once the room ends', async () => {
    const username = `lk_${rand()}`;
    const registration = await request(app)
      .post('/api/auth/register')
      .send({
        username,
        email: `${username}@test.local`,
        password: 'test-password-123',
      });
    expect(registration.status).toBe(201);

    const userId = registration.body.data.user.id as string;
    const token = registration.body.data.accessToken as string;
    userIds.push(userId);

    const creation = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'LiveKit lifecycle regression' });
    expect(creation.status).toBe(201);

    const roomId = creation.body.data.id as string;
    roomIds.push(roomId);

    __livekitMock.events.length = 0;
    __livekitMock.tokenTtls.length = 0;
    __livekitMock.roomServiceHosts.length = 0;
    const whileLive = await request(app)
      .get(`/api/rooms/${roomId}/livekit-token`)
      .set('Authorization', `Bearer ${token}`);
    expect(whileLive.status).toBe(200);
    expect(whileLive.body.data).toEqual(
      expect.objectContaining({
        room: roomId,
        identity: userId,
        canPublish: true,
        url: 'ws://127.0.0.1:7880',
      }),
    );
    expect(typeof whileLive.body.data.token).toBe('string');
    expect(whileLive.body.data.expiresInSec).toBe(300);
    expect(__livekitMock.tokenTtls).toEqual(['300s']);
    expect(__livekitMock.roomServiceHosts).toEqual(['http://livekit:7880']);
    expect(__livekitMock.events).toEqual([`create:${roomId}`, `sign:${roomId}`]);

    // Reproduce the production corruption precisely: the room is terminal,
    // while its historical Participant row incorrectly remains active.
    await prisma.room.update({
      where: { id: roomId },
      data: { isLive: false, endedAt: new Date() },
    });
    const staleParticipant = await prisma.participant.findUnique({
      where: { userId_roomId: { userId, roomId } },
      select: { leftAt: true },
    });
    expect(staleParticipant?.leftAt).toBeNull();

    const afterEnd = await request(app)
      .get(`/api/rooms/${roomId}/livekit-token`)
      .set('Authorization', `Bearer ${token}`);
    expect(afterEnd.status).toBe(410);
    expect(afterEnd.body.error.code).toBe('ROOM_004');
    expect(afterEnd.body.data).toBeUndefined();

    // A normal room close also timestamps every participant's departure.
    // The terminal room state must still win over leftAt so clients receive
    // the stable 410 contract instead of a misleading membership 403.
    await prisma.participant.update({
      where: { userId_roomId: { userId, roomId } },
      data: { leftAt: new Date() },
    });
    const afterNormalEnd = await request(app)
      .get(`/api/rooms/${roomId}/livekit-token`)
      .set('Authorization', `Bearer ${token}`);
    expect(afterNormalEnd.status).toBe(410);
    expect(afterNormalEnd.body.error.code).toBe('ROOM_004');
    expect(afterNormalEnd.body.data).toBeUndefined();
  });
});
