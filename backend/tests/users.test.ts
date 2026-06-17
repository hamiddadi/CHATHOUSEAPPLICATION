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
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

const register = async (app: Express, username?: string) => {
  const u = username ?? `u_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: u, email: `${u}@test.local`, password: 'test-password-123' });
  return {
    id: res.body.data.user.id as string,
    username: u,
    token: res.body.data.accessToken as string,
  };
};

describe('Users — profile CRUD, search, lookup', () => {
  let app: Express;
  const createdIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  // Presence heartbeat — HTTP fallback to the `presence_update` socket event.
  it('POST /api/users/me/heartbeat marks the user online + refreshes lastSeenAt', async () => {
    const user = await register(app);
    createdIds.push(user.id);

    const before = await prisma.user.findUnique({
      where: { id: user.id },
      select: { lastSeenAt: true },
    });

    const res = await request(app)
      .post('/api/users/me/heartbeat')
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.online).toBe(true);

    const after = await prisma.user.findUnique({
      where: { id: user.id },
      select: { isOnline: true, lastSeenAt: true },
    });
    expect(after?.isOnline).toBe(true);
    expect(after?.lastSeenAt?.getTime() ?? 0).toBeGreaterThanOrEqual(
      before?.lastSeenAt?.getTime() ?? 0,
    );
  });

  // 2.2 — Modifier profil
  it('PATCH /api/users/me updates displayName, bio, avatarUrl', async () => {
    const user = await register(app);
    createdIds.push(user.id);

    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        displayName: 'Phase 7 Tester',
        bio: 'Testing Chathouse end-to-end.',
        avatarUrl: 'https://cdn.test.local/u/avatar.jpg',
      });
    expect(res.status).toBe(200);
    expect(res.body.data.displayName).toBe('Phase 7 Tester');
    expect(res.body.data.bio).toBe('Testing Chathouse end-to-end.');
    expect(res.body.data.avatarUrl).toBe('https://cdn.test.local/u/avatar.jpg');

    // Verify persistence via a fresh /me fetch
    const me = await request(app).get('/api/users/me').set('Authorization', `Bearer ${user.token}`);
    expect(me.body.data.bio).toBe('Testing Chathouse end-to-end.');
  });

  // 2.2 — PATCH with an unknown field is rejected by `z.object(...).strict()`
  it('PATCH /api/users/me with an unknown key returns VALIDATION_001', async () => {
    const user = await register(app);
    createdIds.push(user.id);

    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ displayName: 'ok', mystery: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_001');
  });

  // 2.4 — Voir profil public
  it('GET /api/users/:id returns public fields only', async () => {
    const alice = await register(app);
    const bob = await register(app);
    createdIds.push(alice.id, bob.id);

    const res = await request(app)
      .get(`/api/users/${bob.id}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(
      expect.objectContaining({
        id: bob.id,
        username: bob.username,
        displayName: expect.any(String),
        isOnline: expect.any(Boolean),
      }),
    );
    // Private fields must NOT leak through the public profile endpoint.
    expect(res.body.data).not.toHaveProperty('email');
    expect(res.body.data).not.toHaveProperty('latitude');
    expect(res.body.data).not.toHaveProperty('longitude');
  });

  // 2.7 — Profil inexistant
  it('GET /api/users/:id returns 404 USER_001 for an unknown id', async () => {
    const alice = await register(app);
    createdIds.push(alice.id);

    const res = await request(app)
      .get('/api/users/does-not-exist')
      .set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_001');
  });

  // 2.5 + 2.6 — Recherche
  it('GET /api/users/search filters by query (partial, case-insensitive) and returns [] for no match', async () => {
    const prefix = `srch${rand()}`;
    const a = await register(app, `${prefix}_alice`);
    const b = await register(app, `${prefix}_bob`);
    const c = await register(app);
    createdIds.push(a.id, b.id, c.id);

    const ok = await request(app)
      .get(`/api/users/search?q=${prefix}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(ok.status).toBe(200);
    const usernames = ok.body.data.map((u: { username: string }) => u.username);
    expect(usernames).toEqual(expect.arrayContaining([a.username, b.username]));

    const empty = await request(app)
      .get('/api/users/search?q=zzzz-no-one-named-this-zzzz')
      .set('Authorization', `Bearer ${a.token}`);
    expect(empty.body.data).toEqual([]);
  });

  // 2.8 — Accès sans token
  it('GET /api/users/me without Authorization header returns 401 AUTH_003', async () => {
    const res = await request(app).get('/api/users/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_003');
  });

  // Bonus — Ghost Mode + location are wired (already covered in auth.integration
  // for visibility; add location here to close the loop).
  it('PATCH /api/users/me/location persists coords and bumps lastSeenAt', async () => {
    const user = await register(app);
    createdIds.push(user.id);

    const res = await request(app)
      .patch('/api/users/me/location')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ latitude: 48.8566, longitude: 2.3522 });
    expect(res.status).toBe(200);
    expect(res.body.data.latitude).toBeCloseTo(48.8566, 4);
    expect(res.body.data.longitude).toBeCloseTo(2.3522, 4);
    expect(res.body.data.lastSeenAt).toEqual(expect.any(String));
  });

  it('PATCH /api/users/me/location rejects out-of-range coordinates', async () => {
    const user = await register(app);
    createdIds.push(user.id);

    const res = await request(app)
      .patch('/api/users/me/location')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ latitude: 120, longitude: 500 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_001');
  });
});
