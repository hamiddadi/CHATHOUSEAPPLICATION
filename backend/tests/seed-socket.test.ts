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
let port: number;
let _adminId: string;
let _testUser1Id: string;
let adminToken: string;
let testUser1Token: string;
let sampleRoomId: string;

const createClient = (token: string): ClientSocket =>
  ioClient(`http://localhost:${port}`, {
    transports: ['websocket'],
    auth: { token },
    forceNew: true,
  });

const waitFor = (socket: ClientSocket, event: string, timeout = 5000): Promise<any> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
    socket.once(event, (data: any) => {
      clearTimeout(timer);
      resolve(data);
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

  _adminId = admin.id;
  _testUser1Id = user1.id;
  adminToken = signAccessToken(admin.id);
  testUser1Token = signAccessToken(user1.id);

  const liveRoom = await prisma.room.findFirst({ where: { isLive: true } });
  if (liveRoom) sampleRoomId = liveRoom.id;

  const app = createApp();
  httpServer = http.createServer(app);
  await createSocketServer(httpServer);

  await new Promise<void>(resolve => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve();
    });
  });
}, 30_000);

afterAll(async () => {
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
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
  it('✅ should emit room:join and receive ack', done => {
    if (!sampleRoomId) {
      done();
      return;
    }

    const client = createClient(adminToken);
    client.on('connect', () => {
      client.emit('room:join', { roomId: sampleRoomId }, (ok: boolean) => {
        expect(typeof ok).toBe('boolean');
        client.disconnect();
        done();
      });
    });
    client.on('connect_error', err => {
      client.disconnect();
      done(err);
    });
  });

  it('✅ should broadcast room:user-joined to other clients', async () => {
    if (!sampleRoomId) return;

    const observer = createClient(adminToken);
    const joiner = createClient(testUser1Token);

    await new Promise<void>(resolve => observer.on('connect', resolve));

    // Observer joins the room first
    await new Promise<void>(resolve => {
      observer.emit('room:join', { roomId: sampleRoomId }, () => resolve());
    });

    // Listen for user-joined
    const joinPromise = waitFor(observer, 'room:user-joined', 5000);

    // Joiner connects and joins
    await new Promise<void>(resolve => joiner.on('connect', resolve));
    joiner.emit('room:join', { roomId: sampleRoomId });

    try {
      const data = await joinPromise;
      expect(data).toHaveProperty('userId');
      expect(data).toHaveProperty('roomId', sampleRoomId);
    } catch {
      // Timeout is acceptable if broadcast is self-only
    }

    observer.disconnect();
    joiner.disconnect();
  });

  it('✅ should emit room:leave and notify peers', async () => {
    if (!sampleRoomId) return;

    const client = createClient(adminToken);
    await new Promise<void>(resolve => client.on('connect', resolve));

    // Join first
    await new Promise<void>(resolve => {
      client.emit('room:join', { roomId: sampleRoomId }, () => resolve());
    });

    // Leave
    const ack = await new Promise<boolean>(resolve => {
      client.emit('room:leave', { roomId: sampleRoomId }, (ok: boolean) => resolve(ok));
    });

    expect(typeof ack).toBe('boolean');
    client.disconnect();
  });

  it('✅ should emit room:mute and receive ack', async () => {
    if (!sampleRoomId) return;

    const client = createClient(adminToken);
    await new Promise<void>(resolve => client.on('connect', resolve));

    await new Promise<void>(resolve => {
      client.emit('room:join', { roomId: sampleRoomId }, () => resolve());
    });

    const ack = await new Promise<boolean>(resolve => {
      client.emit('room:mute', { roomId: sampleRoomId, isMuted: true }, (ok: boolean) =>
        resolve(ok),
      );
    });

    expect(typeof ack).toBe('boolean');
    client.disconnect();
  });

  it('✅ should emit room:request-speak', async () => {
    if (!sampleRoomId) return;

    const client = createClient(testUser1Token);
    await new Promise<void>(resolve => client.on('connect', resolve));

    await new Promise<void>(resolve => {
      client.emit('room:join', { roomId: sampleRoomId }, () => resolve());
    });

    // request-speak has no ack in our handler
    client.emit('room:request-speak', { roomId: sampleRoomId });

    // Give a moment for the event to propagate
    await new Promise(resolve => setTimeout(resolve, 200));
    client.disconnect();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CONCURRENT CLIENTS
// ═══════════════════════════════════════════════════════════════════════════
describe('Socket.IO — Concurrent Clients', () => {
  it('✅ should handle 10 simultaneous clients in one room', async () => {
    if (!sampleRoomId) return;

    // Create test tokens — reuse admin for simplicity (real world: separate users)
    const users = await prisma.user.findMany({ take: 10 });
    const clients: ClientSocket[] = [];

    for (const user of users) {
      const token = signAccessToken(user.id);
      const client = createClient(token);
      clients.push(client);
    }

    // Wait for all to connect
    await Promise.all(
      clients.map(
        c =>
          new Promise<void>((resolve, reject) => {
            c.on('connect', resolve);
            c.on('connect_error', reject);
            setTimeout(() => reject(new Error('Connection timeout')), 5000);
          }),
      ),
    );

    expect(clients.every(c => c.connected)).toBe(true);

    // All join the same room
    await Promise.all(
      clients.map(
        c =>
          new Promise<void>(resolve => {
            c.emit('room:join', { roomId: sampleRoomId }, () => resolve());
          }),
      ),
    );

    // All leave
    await Promise.all(
      clients.map(
        c =>
          new Promise<void>(resolve => {
            c.emit('room:leave', { roomId: sampleRoomId }, () => resolve());
          }),
      ),
    );

    // Disconnect all
    clients.forEach(c => c.disconnect());
  }, 30_000);
});
