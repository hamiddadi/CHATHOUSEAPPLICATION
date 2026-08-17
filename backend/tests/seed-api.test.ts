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
import { currentLegalDocumentVersion } from '../src/modules/auth/legal-acceptance';
import { signAccessToken } from '../src/utils/jwt';

const app = createApp();

const REGISTER_EMAIL = 'seed-api-contract@chathouse.dev';
const REGISTER_USERNAME = 'seedapicontract';
const FIXTURE_ROOM_TITLE = 'Seed API deterministic fixture room';
const CREATED_ROOM_TITLE = 'Seed API created room contract';
const FIXTURE_NOTIFICATION_DEDUPE_KEY = 'seed-api-contract-unread-notification';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
let adminToken: string;
let testUser1Token: string;
let testUser1Id: string;
let testUser2Id: string;
let adminId: string;
let sampleRoomId: string;
let fixtureNotificationId: string;

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
  adminToken = signAccessToken(admin.id, admin.tokenVersion);
  testUser1Token = signAccessToken(user1.id, user1.tokenVersion);

  // Remove leftovers from an interrupted local run, then create fixtures whose
  // state does not depend on Faker output or on another seed test's ordering.
  await prisma.room.deleteMany({
    where: { hostId: admin.id, title: { in: [FIXTURE_ROOM_TITLE, CREATED_ROOM_TITLE] } },
  });
  await prisma.notification.deleteMany({
    where: { dedupeKey: FIXTURE_NOTIFICATION_DEDUPE_KEY },
  });
  await prisma.user.deleteMany({ where: { email: REGISTER_EMAIL } });

  const resetFollow = await request(app)
    .delete(`/api/follow/${user2.id}`)
    .set('Authorization', `Bearer ${testUser1Token}`);
  if (resetFollow.status !== 200) {
    throw new Error(`Could not reset seed follow fixture: HTTP ${resetFollow.status}`);
  }

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
        create: { userId: admin.id, role: 'HOST', admissionConfirmedAt: new Date() },
      },
    },
  });
  sampleRoomId = fixtureRoom.id;

  const fixtureNotification = await prisma.notification.create({
    data: {
      userId: admin.id,
      actorId: user1.id,
      type: 'NEW_FOLLOWER',
      title: 'Seed API unread notification',
      body: 'Deterministic notification used by the seeded API contract.',
      targetId: user1.id,
      targetType: 'user',
      dedupeKey: FIXTURE_NOTIFICATION_DEDUPE_KEY,
    },
  });
  fixtureNotificationId = fixtureNotification.id;
});

afterAll(async () => {
  await prisma.notification.deleteMany({
    where: { dedupeKey: FIXTURE_NOTIFICATION_DEDUPE_KEY },
  });
  await prisma.room.deleteMany({
    where: { hostId: adminId, title: { in: [FIXTURE_ROOM_TITLE, CREATED_ROOM_TITLE] } },
  });
  await prisma.user.deleteMany({ where: { email: REGISTER_EMAIL } });
  await disconnectRedis();
  await prisma.$disconnect();
});

describe('SEED FIXTURE — legal acceptance', () => {
  it.each(['admin@chathouse.dev', 'test1@chathouse.dev', 'test2@chathouse.dev'])(
    'seeds %s with the current explicit legal acknowledgement',
    async email => {
      const seededUser = await prisma.user.findUnique({ where: { email } });
      const currentVersion = currentLegalDocumentVersion();

      expect(seededUser).toEqual(
        expect.objectContaining({
          termsAcceptedVersion: currentVersion,
          termsAcceptedAt: expect.any(Date),
          privacyNoticeAcknowledgedVersion: currentVersion,
          privacyNoticeAcknowledgedAt: expect.any(Date),
          legalAcceptanceLocale: 'en',
        }),
      );
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTH MODULE
// ═══════════════════════════════════════════════════════════════════════════
describe('AUTH — /api/auth', () => {
  describe('POST /api/auth/register', () => {
    it('✅ should register a new user with valid data', async () => {
      await prisma.user.deleteMany({ where: { email: REGISTER_EMAIL } });
      const res = await request(app).post('/api/auth/register').send({
        email: REGISTER_EMAIL,
        password: 'StrongPass123!',
        username: REGISTER_USERNAME,
        displayName: 'Seed Test',
      });

      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data).toHaveProperty('refreshToken');
    });

    it('❌ should reject duplicate email', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: 'admin@chathouse.dev',
        password: 'StrongPass123!',
        username: 'seedapiduplicate',
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

      expect(loginRes.status).toBe(200);
      const token = loginRes.body.data?.accessToken;
      expect(token).toEqual(expect.any(String));
      if (typeof token !== 'string') {
        throw new Error('Login response did not contain an access token');
      }

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ loggedOut: true });

      const refreshedUser = await prisma.user.findUnique({
        where: { id: testUser1Id },
        select: { tokenVersion: true },
      });
      if (!refreshedUser) throw new Error('Seed test user disappeared after logout');
      testUser1Token = signAccessToken(testUser1Id, refreshedUser.tokenVersion);
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
        .send({ title: CREATED_ROOM_TITLE, topics: ['tech'] });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toEqual(expect.any(String));
      createdRoomId = res.body.data.id as string;
    });

    it('❌ should reject unauthenticated room creation', async () => {
      const res = await request(app).post('/api/rooms').send({ title: 'Unauthorized Room' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/rooms/:id', () => {
    it('✅ should return room details', async () => {
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
      const res = await request(app)
        .post(`/api/rooms/${sampleRoomId}/join`)
        .set('Authorization', `Bearer ${testUser1Token}`);

      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/rooms/:id/leave', () => {
    it('✅ should leave a room', async () => {
      const res = await request(app)
        .post(`/api/rooms/${sampleRoomId}/leave`)
        .set('Authorization', `Bearer ${testUser1Token}`);

      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/rooms/:id', () => {
    it('✅ should delete/end room (owner only)', async () => {
      expect(createdRoomId).toEqual(expect.any(String));

      const res = await request(app)
        .delete(`/api/rooms/${createdRoomId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    it('❌ should reject deletion by non-owner', async () => {
      const res = await request(app)
        .delete(`/api/rooms/${sampleRoomId}`)
        .set('Authorization', `Bearer ${testUser1Token}`);

      expect(res.status).toBe(403);
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

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ following: true });
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

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ following: false });
    });
  });

  describe('GET /api/follow/followers', () => {
    it('✅ should list followers', async () => {
      const res = await request(app)
        .get('/api/follow/followers')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            data: expect.any(Array),
            hasMore: expect.any(Boolean),
          }),
        }),
      );
      if (res.body.data.hasMore) {
        expect(res.body.data.nextCursor).toEqual(expect.any(String));
      } else {
        expect(res.body.data.nextCursor).toBeNull();
      }
      for (const follower of res.body.data.data) {
        expect(follower).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            createdAt: expect.any(String),
            isFollowedByMe: expect.any(Boolean),
            followRequestedByMe: expect.any(Boolean),
          }),
        );
      }
    });
  });

  describe('GET /api/follow/following', () => {
    it('✅ should list following', async () => {
      const res = await request(app)
        .get('/api/follow/following')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            data: expect.any(Array),
            hasMore: expect.any(Boolean),
          }),
        }),
      );
      if (res.body.data.hasMore) {
        expect(res.body.data.nextCursor).toEqual(expect.any(String));
      } else {
        expect(res.body.data.nextCursor).toBeNull();
      }
      for (const followedUser of res.body.data.data) {
        expect(followedUser).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            createdAt: expect.any(String),
            isFollowedByMe: expect.any(Boolean),
            followRequestedByMe: expect.any(Boolean),
            canDirectMessage: expect.any(Boolean),
          }),
        );
      }
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
      expect(res.body.data).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: fixtureNotificationId })]),
      );
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
      expect(res.body.data.count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('PATCH /api/notifications/:id/read', () => {
    it('✅ should mark a notification as read', async () => {
      const res = await request(app)
        .patch(`/api/notifications/${fixtureNotificationId}/read`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      await expect(
        prisma.notification.findUnique({ where: { id: fixtureNotificationId } }),
      ).resolves.toEqual(expect.objectContaining({ isRead: true }));
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
