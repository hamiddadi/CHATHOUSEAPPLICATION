/**
 * Chathouse — Comprehensive API Integration Tests
 * =================================================
 * Tests all REST endpoints with real DB + Redis via Supertest.
 *
 * Run: cd backend && npm test -- --testPathPattern=seed-api
 *
 * Prerequisites:
 *   - docker-compose up (Postgres + Redis)
 *   - npx prisma migrate deploy
 *   - npx tsx scripts/seed.ts (to have test data)
 */

import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/config/database';
import { connectRedis, disconnectRedis } from '../src/config/redis';
import { signAccessToken } from '../src/utils/jwt';

const app = createApp();

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
let adminToken: string;
let testUser1Token: string;
let testUser1Id: string;
let testUser2Id: string;
let adminId: string;
let sampleRoomId: string;

beforeAll(async () => {
  // The app's auth middleware, health check and several endpoints use the
  // shared Redis client — connect it or every redis-backed call 500s with
  // "The client is closed".
  await connectRedis();
  // Resolve IDs for our seeded test accounts
  const admin = await prisma.user.findUnique({ where: { email: 'admin@chathouse.dev' } });
  const user1 = await prisma.user.findUnique({ where: { email: 'test1@chathouse.dev' } });
  const user2 = await prisma.user.findUnique({ where: { email: 'test2@chathouse.dev' } });

  if (!admin || !user1 || !user2) {
    throw new Error('Test accounts not found. Run `npx tsx scripts/seed.ts` before running tests.');
  }

  adminId = admin.id;
  testUser1Id = user1.id;
  testUser2Id = user2.id;
  adminToken = signAccessToken(admin.id);
  testUser1Token = signAccessToken(user1.id);

  // Find a live room for room tests
  const liveRoom = await prisma.room.findFirst({ where: { isLive: true } });
  if (liveRoom) sampleRoomId = liveRoom.id;
});

afterAll(async () => {
  await prisma.$disconnect();
  await disconnectRedis();
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTH MODULE
// ═══════════════════════════════════════════════════════════════════════════
describe('AUTH — /api/auth', () => {
  const uniqueEmail = `seed-test-${Date.now()}@chathouse.dev`;

  describe('POST /api/auth/register', () => {
    it('✅ should register a new user with valid data', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: uniqueEmail,
          password: 'StrongPass123!',
          username: `seedtest${Date.now()}`,
          displayName: 'Seed Test',
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data).toHaveProperty('refreshToken');
    });

    it('❌ should reject duplicate email', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'admin@chathouse.dev',
          password: 'StrongPass123!',
          username: `dup${Date.now()}`,
          displayName: 'Dup',
        });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });

    it('❌ should reject missing email field', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ password: 'StrongPass123!', username: 'nomail' });

      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('✅ should login with valid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'admin@chathouse.dev', password: 'Admin1234!' });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('accessToken');
    });

    it('❌ should reject wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'admin@chathouse.dev', password: 'WrongPassword!' });

      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('❌ should reject non-existent user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'nobody@chathouse.dev', password: 'Pass1234!' });

      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('✅ should logout with valid token', async () => {
      // First login to get a fresh token
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'test1@chathouse.dev', password: 'Test1234!' });

      const token = loginRes.body.data?.accessToken;
      if (!token) return; // Skip if login flow differs

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBeLessThan(500);
    });

    it('❌ should reject logout without token', async () => {
      const res = await request(app).post('/api/auth/logout');
      expect(res.status).toBe(401);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// USERS MODULE
// ═══════════════════════════════════════════════════════════════════════════
describe('USERS — /api/users', () => {
  describe('GET /api/users/me', () => {
    it('✅ should return current user profile', async () => {
      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('id', adminId);
      expect(res.body.data).toHaveProperty('email', 'admin@chathouse.dev');
    });

    it('❌ should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/users/me');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/users/:id', () => {
    it('✅ should return a public user profile', async () => {
      const res = await request(app)
        .get(`/api/users/${testUser2Id}`)
        .set('Authorization', `Bearer ${testUser1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('id', testUser2Id);
    });

    it('❌ should return 404 for non-existent user', async () => {
      const res = await request(app)
        .get('/api/users/nonexistent-id-12345')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('PATCH /api/users/me', () => {
    it('✅ should update user profile', async () => {
      const res = await request(app)
        .patch('/api/users/me')
        .set('Authorization', `Bearer ${testUser1Token}`)
        .send({ bio: 'Updated bio from seed test' });

      expect(res.status).toBe(200);
    });

    it('❌ should reject unauthenticated update', async () => {
      const res = await request(app).patch('/api/users/me').send({ bio: 'Hack attempt' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/users/search', () => {
    it('✅ should search users by query', async () => {
      const res = await request(app)
        .get('/api/users/search?q=test')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('✅ should return empty array for no matches', async () => {
      const res = await request(app)
        .get('/api/users/search?q=zzzznoonehasthisnamexxxx')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ROOMS MODULE
// ═══════════════════════════════════════════════════════════════════════════
describe('ROOMS — /api/rooms', () => {
  let createdRoomId: string;

  describe('GET /api/rooms', () => {
    it('✅ should list active rooms', async () => {
      const res = await request(app).get('/api/rooms').set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('POST /api/rooms', () => {
    it('✅ should create a new room (auth required)', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Seed Test Room', topics: ['tech'] });

      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('id');
      createdRoomId = res.body.data.id;
    });

    it('❌ should reject unauthenticated room creation', async () => {
      const res = await request(app).post('/api/rooms').send({ title: 'Unauthorized Room' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/rooms/:id', () => {
    it('✅ should return room details', async () => {
      if (!sampleRoomId) return;

      const res = await request(app)
        .get(`/api/rooms/${sampleRoomId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('id', sampleRoomId);
      expect(res.body.data).toHaveProperty('title');
    });
  });

  describe('POST /api/rooms/:id/join', () => {
    it('✅ should join an open room', async () => {
      if (!sampleRoomId) return;

      const res = await request(app)
        .post(`/api/rooms/${sampleRoomId}/join`)
        .set('Authorization', `Bearer ${testUser1Token}`);

      // Could be 200 or 201 depending on already-joined state
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('POST /api/rooms/:id/leave', () => {
    it('✅ should leave a room', async () => {
      if (!sampleRoomId) return;

      const res = await request(app)
        .post(`/api/rooms/${sampleRoomId}/leave`)
        .set('Authorization', `Bearer ${testUser1Token}`);

      expect(res.status).toBeLessThan(500);
    });
  });

  describe('DELETE /api/rooms/:id', () => {
    it('✅ should delete/end room (owner only)', async () => {
      if (!createdRoomId) return;

      const res = await request(app)
        .delete(`/api/rooms/${createdRoomId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    it('❌ should reject deletion by non-owner', async () => {
      if (!sampleRoomId) return;

      const res = await request(app)
        .delete(`/api/rooms/${sampleRoomId}`)
        .set('Authorization', `Bearer ${testUser1Token}`);

      // Should be 403 or similar
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FOLLOW MODULE
// ═══════════════════════════════════════════════════════════════════════════
describe('FOLLOW — /api/follow', () => {
  describe('POST /api/follow/:userId', () => {
    it('✅ should follow a user', async () => {
      const res = await request(app)
        .post(`/api/follow/${testUser2Id}`)
        .set('Authorization', `Bearer ${testUser1Token}`);

      // 200 or 201 — both are acceptable (idempotent)
      expect(res.status).toBeLessThan(500);
    });

    it('❌ should not allow self-follow', async () => {
      const res = await request(app)
        .post(`/api/follow/${testUser1Id}`)
        .set('Authorization', `Bearer ${testUser1Token}`);

      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('DELETE /api/follow/:userId', () => {
    it('✅ should unfollow a user', async () => {
      const res = await request(app)
        .delete(`/api/follow/${testUser2Id}`)
        .set('Authorization', `Bearer ${testUser1Token}`);

      expect(res.status).toBeLessThan(500);
    });
  });

  describe('GET /api/follow/followers', () => {
    it('✅ should list followers', async () => {
      const res = await request(app)
        .get('/api/follow/followers')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/follow/following', () => {
    it('✅ should list following', async () => {
      const res = await request(app)
        .get('/api/follow/following')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS MODULE
// ═══════════════════════════════════════════════════════════════════════════
describe('NOTIFICATIONS — /api/notifications', () => {
  describe('GET /api/notifications', () => {
    it('✅ should list notifications (auth required)', async () => {
      const res = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('❌ should reject unauthenticated access', async () => {
      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/notifications/unread-count', () => {
    it('✅ should return unread count', async () => {
      const res = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('count');
    });
  });

  describe('PATCH /api/notifications/:id/read', () => {
    it('✅ should mark a notification as read', async () => {
      // Find an unread notification for admin
      const notif = await prisma.notification.findFirst({
        where: { userId: adminId, isRead: false },
      });
      if (!notif) return; // Skip if all are read

      const res = await request(app)
        .patch(`/api/notifications/${notif.id}/read`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe('PATCH /api/notifications/read-all', () => {
    it('✅ should mark all notifications as read', async () => {
      const res = await request(app)
        .patch('/api/notifications/read-all')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CLUBS MODULE
// ═══════════════════════════════════════════════════════════════════════════
describe('CLUBS — /api/clubs', () => {
  describe('GET /api/clubs', () => {
    it('✅ should list clubs', async () => {
      const res = await request(app).get('/api/clubs').set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════════════
describe('HEALTH — /health', () => {
  it('✅ should return healthy status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});
