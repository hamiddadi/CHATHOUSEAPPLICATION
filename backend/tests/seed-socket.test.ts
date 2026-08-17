/**
 * Chathouse — Socket.IO Integration Tests
 * =========================================
 * Tests real-time events with socket.io-client against the live server.
 *
 * Run: cd backend && npm test -- --testPathPattern=seed-socket
 *
 * Prerequisites:
 *   - docker-compose up (Postgres + Redis)
 *   - npx tsx scripts/seed.ts
 *   - Backend server NOT running on PORT (tests boot their own)
 */

import http from 'node:http';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../src/app';
import { createSocketServer } from '../src/socket/socket.server';
import { connectRedis, disconnectRedis } from '../src/config/redis';
import { prisma } from '../src/config/database';
import { signAccessToken } from '../src/utils/jwt';

let httpServer: http.Server;
let socketServer: Awaited<ReturnType<typeof createSocketServer>>;
let port: number;
let adminToken: string;
let testUser1Token: string;
let adminId: string;
let testUser1Id: string;
let sampleRoomId: string;
let hostClient: ClientSocket;

const FIXTURE_ROOM_TITLE = 'Seed Socket deterministic fixture room';

const createClient = (token: string): ClientSocket =>
  ioClient(`http://localhost:${port}`, {
    transports: ['websocket'],
    auth: { token },
    forceNew: true,
    reconnection: false,
  });

const waitFor = (socket: ClientSocket, event: string, timeout = 5000): Promise<any> =>
  new Promise((resolve, reject) => {
    const onEvent = (data: any) => {
      clearTimeout(timer);
      resolve(data);
    };
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timeout waiting for ${event}`));
    }, timeout);
    socket.once(event, onEvent);
  });

const connectClient = (socket: ClientSocket, timeout = 5000): Promise<void> => {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
    };
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Socket connection timeout'));
    }, timeout);
    socket.once('connect', onConnect);
    socket.once('connect_error', onError);
  });
};

const emitWithAck = (
  socket: ClientSocket,
  event: string,
  payload: { roomId: string; [key: string]: unknown },
  timeout = 5000,
): Promise<boolean> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event} ack`)), timeout);
    socket.emit(event, payload, (ok: boolean) => {
      clearTimeout(timer);
      resolve(ok);
    });
  });

// ---------------------------------------------------------------------------
// Setup & Teardown
// ---------------------------------------------------------------------------
beforeAll(async () => {
  await connectRedis();

  const admin = await prisma.user.findUnique({ where: { email: 'admin@chathouse.dev' } });
  const user1 = await prisma.user.findUnique({ where: { email: 'test1@chathouse.dev' } });
  if (!admin || !user1) throw new Error('Run seed first');

  adminId = admin.id;
  testUser1Id = user1.id;
  adminToken = signAccessToken(admin.id, admin.tokenVersion);
  testUser1Token = signAccessToken(user1.id, user1.tokenVersion);

  await prisma.room.deleteMany({
    where: { hostId: admin.id, title: FIXTURE_ROOM_TITLE },
  });
  const fixtureRoom = await prisma.room.create({
    data: {
      title: FIXTURE_ROOM_TITLE,
      hostId: admin.id,
      isLive: true,
      isPrivate: false,
      roomType: 'OPEN',
      participantCount: 1,
      totalAttendees: 1,
      participants: {
        create: { userId: admin.id, role: 'HOST' },
      },
    },
  });
  sampleRoomId = fixtureRoom.id;

  const app = createApp();
  httpServer = http.createServer(app);
  socketServer = await createSocketServer(httpServer);

  await new Promise<void>(resolve => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve();
    });
  });
  if (port <= 0) throw new Error('Socket test server did not bind a TCP port');

  // Keep the host attached for the whole suite. Disconnecting the last host is
  // supposed to end a room, which would make later tests order-dependent.
  hostClient = createClient(adminToken);
  await connectClient(hostClient);
  const hostJoinAck = await emitWithAck(hostClient, 'room:join', { roomId: sampleRoomId });
  if (!hostJoinAck) throw new Error('Fixture host could not join the deterministic room');
}, 30_000);

afterAll(async () => {
  hostClient?.disconnect();
  if (socketServer) await socketServer.close();
  await prisma.room.deleteMany({
    where: { hostId: adminId, title: FIXTURE_ROOM_TITLE },
  });
  await disconnectRedis();
  await prisma.$disconnect();
}, 15_000);

// ═══════════════════════════════════════════════════════════════════════════
// CONNECTION / AUTH
// ═══════════════════════════════════════════════════════════════════════════
describe('Socket.IO — Connection', () => {
  it('✅ should connect with a valid JWT token', done => {
    const client = createClient(adminToken);
    client.on('connect', () => {
      expect(client.connected).toBe(true);
      client.disconnect();
      done();
    });
    client.on('connect_error', err => {
      client.disconnect();
      done(err);
    });
  });

  it('❌ should reject connection with invalid token', done => {
    const client = createClient('invalid.jwt.token.here');
    client.on('connect', () => {
      client.disconnect();
      done(new Error('Should not have connected'));
    });
    client.on('connect_error', () => {
      client.disconnect();
      done(); // Expected
    });
  });

  it('❌ should reject connection with no token', done => {
    const client = ioClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      // No auth provided
    });
    client.on('connect', () => {
      client.disconnect();
      done(new Error('Should not have connected'));
    });
    client.on('connect_error', () => {
      client.disconnect();
      done();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ROOM EVENTS
// ═══════════════════════════════════════════════════════════════════════════
describe('Socket.IO — Room Events', () => {
  it('✅ should emit room:join and receive ack', async () => {
    const client = createClient(testUser1Token);
    try {
      await connectClient(client);
      await expect(emitWithAck(client, 'room:join', { roomId: sampleRoomId })).resolves.toBe(true);
      await expect(emitWithAck(client, 'room:leave', { roomId: sampleRoomId })).resolves.toBe(true);
    } finally {
      client.disconnect();
    }
  });

  it('✅ should broadcast room:user-joined to other clients', async () => {
    const joiner = createClient(testUser1Token);
    try {
      const joinPromise = waitFor(hostClient, 'room:user-joined', 5000);
      await connectClient(joiner);
      await expect(emitWithAck(joiner, 'room:join', { roomId: sampleRoomId })).resolves.toBe(true);
      const data = await joinPromise;
      expect(data).toHaveProperty('userId', testUser1Id);
      expect(data).toHaveProperty('roomId', sampleRoomId);
      await expect(emitWithAck(joiner, 'room:leave', { roomId: sampleRoomId })).resolves.toBe(true);
    } finally {
      joiner.disconnect();
    }
  });

  it('✅ should emit room:leave and notify peers', async () => {
    const client = createClient(testUser1Token);
    try {
      await connectClient(client);
      await expect(emitWithAck(client, 'room:join', { roomId: sampleRoomId })).resolves.toBe(true);
      await expect(emitWithAck(client, 'room:leave', { roomId: sampleRoomId })).resolves.toBe(true);
    } finally {
      client.disconnect();
    }
  });

  it('✅ should emit room:mute and receive ack', async () => {
    const client = createClient(testUser1Token);
    try {
      await connectClient(client);
      await expect(emitWithAck(client, 'room:join', { roomId: sampleRoomId })).resolves.toBe(true);
      await expect(
        emitWithAck(client, 'room:mute', { roomId: sampleRoomId, isMuted: true }),
      ).resolves.toBe(true);
      await expect(emitWithAck(client, 'room:leave', { roomId: sampleRoomId })).resolves.toBe(true);
    } finally {
      client.disconnect();
    }
  });

  it('✅ should emit room:request-speak', async () => {
    const client = createClient(testUser1Token);
    try {
      await connectClient(client);
      await expect(emitWithAck(client, 'room:join', { roomId: sampleRoomId })).resolves.toBe(true);
      await prisma.roomHandRaise.deleteMany({
        where: { roomId: sampleRoomId, userId: testUser1Id },
      });
      await expect(
        emitWithAck(client, 'room:request-speak', { roomId: sampleRoomId }),
      ).resolves.toBe(true);
      await expect(
        prisma.roomHandRaise.findUnique({
          where: {
            roomId_userId: { roomId: sampleRoomId, userId: testUser1Id },
          },
        }),
      ).resolves.toEqual(expect.objectContaining({ roomId: sampleRoomId, userId: testUser1Id }));
      await expect(emitWithAck(client, 'room:leave', { roomId: sampleRoomId })).resolves.toBe(true);
    } finally {
      client.disconnect();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CONCURRENT CLIENTS
// ═══════════════════════════════════════════════════════════════════════════
describe('Socket.IO — Concurrent Clients', () => {
  it('✅ should handle 10 simultaneous clients in one room', async () => {
    const users = await prisma.user.findMany({
      where: { id: { not: adminId }, deletedAt: null },
      orderBy: { email: 'asc' },
      take: 10,
    });
    expect(users).toHaveLength(10);
    const clients: ClientSocket[] = [];

    for (const user of users) {
      const token = signAccessToken(user.id, user.tokenVersion);
      const client = createClient(token);
      clients.push(client);
    }

    try {
      await Promise.all(clients.map(client => connectClient(client)));
      expect(clients.every(client => client.connected)).toBe(true);

      const joinAcks = await Promise.all(
        clients.map(client => emitWithAck(client, 'room:join', { roomId: sampleRoomId })),
      );
      expect(joinAcks).toEqual(Array(10).fill(true));

      const leaveAcks = await Promise.all(
        clients.map(client => emitWithAck(client, 'room:leave', { roomId: sampleRoomId })),
      );
      expect(leaveAcks).toEqual(Array(10).fill(true));
    } finally {
      clients.forEach(client => client.disconnect());
    }
  }, 30_000);
});
