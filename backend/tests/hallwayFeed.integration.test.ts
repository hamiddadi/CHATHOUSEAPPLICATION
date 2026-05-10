import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type { Express } from 'express';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { Server as IoServer } from 'socket.io';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/* eslint-disable @typescript-eslint/no-require-imports */
const { createApp } = require('../src/app') as typeof import('../src/app');
const { createSocketServer } =
  require('../src/socket/socket.server') as typeof import('../src/socket/socket.server');
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { connectRedis, disconnectRedis } =
  require('../src/config/redis') as typeof import('../src/config/redis');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

const register = async (app: Express) => {
  const u = `hw_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: u, email: `${u}@test.local`, password: 'test-password-123' });
  return { id: res.body.data.user.id as string, token: res.body.data.accessToken as string };
};

describe('Hallway feed — scoring + realtime broadcasts', () => {
  let app: Express;
  let server: http.Server;
  let io: IoServer;
  let url: string;
  const createdUsers: string[] = [];
  const createdRooms: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
    server = http.createServer(app);
    io = await createSocketServer(server);
    await new Promise<void>(r => server.listen(0, r));
    const addr = server.address() as AddressInfo;
    url = `http://127.0.0.1:${addr.port}`;
  }, 30_000);

  afterAll(async () => {
    for (const id of createdRooms) {
      await prisma.room.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdUsers) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await new Promise<void>(r => io.close(() => r()));
    await prisma.$disconnect();
    await disconnectRedis();
  });

  const connect = (token: string): Promise<ClientSocket> =>
    new Promise((resolve, reject) => {
      const s = ioClient(url, {
        transports: ['websocket'],
        auth: { token },
        reconnection: false,
        forceNew: true,
      });
      s.once('connect', () => resolve(s));
      s.once('connect_error', reject);
    });

  it('GET /rooms/feed ranks rooms hosted by follows above random rooms', async () => {
    const viewer = await register(app);
    const friend = await register(app);
    const stranger = await register(app);
    createdUsers.push(viewer.id, friend.id, stranger.id);

    // viewer follows friend
    await request(app)
      .post(`/api/follow/${friend.id}`)
      .set('Authorization', `Bearer ${viewer.token}`);

    // stranger creates a live room (no connection to viewer)
    const strangerRoom = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ title: 'Random stranger room' });
    createdRooms.push(strangerRoom.body.data.id);

    // friend creates a live room (viewer follows the host → should rank higher)
    const friendRoom = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${friend.token}`)
      .send({ title: 'Friend room' });
    createdRooms.push(friendRoom.body.data.id);

    const feed = await request(app)
      .get('/api/rooms/feed?limit=20')
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(feed.status).toBe(200);

    const friendIdx = feed.body.data.findIndex(
      (r: { id: string }) => r.id === friendRoom.body.data.id,
    );
    const strangerIdx = feed.body.data.findIndex(
      (r: { id: string }) => r.id === strangerRoom.body.data.id,
    );
    expect(friendIdx).toBeGreaterThanOrEqual(0);
    expect(strangerIdx).toBeGreaterThanOrEqual(0);
    expect(friendIdx).toBeLessThan(strangerIdx);

    // The friend room should be flagged with known speakers.
    const friendEntry = feed.body.data[friendIdx];
    expect(friendEntry.hasKnownSpeakers).toBe(true);
    expect((friendEntry.knownSpeakers as { id: string }[]).some(k => k.id === friend.id)).toBe(
      true,
    );
  });

  it('interests match boosts a room whose title contains the viewer interest', async () => {
    const viewer = await register(app);
    const host = await register(app);
    createdUsers.push(viewer.id, host.id);

    // Seed viewer interests
    await request(app)
      .patch('/api/users/me/interests')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ interests: ['crypto', 'music'] });

    const offTopic = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Gardening chat' });
    createdRooms.push(offTopic.body.data.id);

    const onTopic = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Crypto market mood' });
    createdRooms.push(onTopic.body.data.id);

    const feed = await request(app)
      .get('/api/rooms/feed')
      .set('Authorization', `Bearer ${viewer.token}`);
    const onIdx = feed.body.data.findIndex((r: { id: string }) => r.id === onTopic.body.data.id);
    const offIdx = feed.body.data.findIndex((r: { id: string }) => r.id === offTopic.body.data.id);
    expect(onIdx).toBeLessThan(offIdx);
  });

  it('private rooms are excluded from the feed', async () => {
    const viewer = await register(app);
    const host = await register(app);
    createdUsers.push(viewer.id, host.id);

    const priv = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Private hush', isPrivate: true });
    createdRooms.push(priv.body.data.id);

    const feed = await request(app)
      .get('/api/rooms/feed')
      .set('Authorization', `Bearer ${viewer.token}`);
    const ids = feed.body.data.map((r: { id: string }) => r.id);
    expect(ids).not.toContain(priv.body.data.id);
  });

  it('hallway:room_created is broadcast when a public live room is created', async () => {
    const viewer = await register(app);
    const host = await register(app);
    createdUsers.push(viewer.id, host.id);

    const socket = await connect(viewer.token);
    const received = new Promise<{ id: string; title: string }>(resolve => {
      socket.once('hallway:room_created', resolve);
    });

    const res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Announcing live!' });
    createdRooms.push(res.body.data.id);

    const event = await received;
    expect(event.id).toBe(res.body.data.id);
    expect(event.title).toBe('Announcing live!');
    socket.disconnect();
  }, 20_000);

  it('hallway:room_closed fires when the host ends the room', async () => {
    const viewer = await register(app);
    const host = await register(app);
    createdUsers.push(viewer.id, host.id);

    const created = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Will be closed' });
    createdRooms.push(created.body.data.id);

    const socket = await connect(viewer.token);
    const received = new Promise<{ roomId: string }>(resolve => {
      socket.once('hallway:room_closed', resolve);
    });

    await request(app)
      .delete(`/api/rooms/${created.body.data.id}`)
      .set('Authorization', `Bearer ${host.token}`);

    const event = await received;
    expect(event.roomId).toBe(created.body.data.id);
    socket.disconnect();
  }, 20_000);

  it('private rooms do NOT fire hallway:room_created', async () => {
    const viewer = await register(app);
    const host = await register(app);
    createdUsers.push(viewer.id, host.id);

    const socket = await connect(viewer.token);
    let received = false;
    socket.once('hallway:room_created', () => {
      received = true;
    });

    const res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Silent private', isPrivate: true });
    createdRooms.push(res.body.data.id);

    // Give the event loop a beat to confirm nothing fires.
    await new Promise(r => setTimeout(r, 200));
    expect(received).toBe(false);
    socket.disconnect();
  }, 20_000);
});
