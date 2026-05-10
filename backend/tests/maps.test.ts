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

const register = async (app: Express) => {
  const u = `m_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: u, email: `${u}@test.local`, password: 'test-password-123' });
  return { id: res.body.data.user.id as string, token: res.body.data.accessToken as string };
};

// Bring a user to the "online + visible + located + recent" state that
// getOnlineLocations requires. The list excludes users with isOnline=false,
// so we flip that flag directly (no auto-hook wires it today).
const makeLiveOnMap = async (
  token: string,
  id: string,
  coords: { latitude: number; longitude: number },
) => {
  await prisma.user.update({ where: { id }, data: { isOnline: true } });
  const res = await request(app0()!)
    .patch('/api/users/me/location')
    .set('Authorization', `Bearer ${token}`)
    .send(coords);
  return res;
};

// Hack: we need to access `app` from the helper. Declare here and assign
// in beforeAll; cleaner than passing `app` through every call.
let app0Ref: Express | null = null;
const app0 = (): Express | null => app0Ref;

describe('Maps — Ghost Mode + online-locations filtering', () => {
  let app: Express;
  const createdIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
    app0Ref = app;
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  // 6.1 — GET /api/maps/users returns visible, online, located, recent peers
  // 6.3 — Ghost Mode OFF (isVisible=true, default) → user appears
  it('returns peers who are online + visible + have coords, excluding the viewer', async () => {
    const viewer = await register(app);
    const peerA = await register(app);
    const peerB = await register(app);
    createdIds.push(viewer.id, peerA.id, peerB.id);

    await makeLiveOnMap(peerA.token, peerA.id, { latitude: 48.8566, longitude: 2.3522 });
    await makeLiveOnMap(peerB.token, peerB.id, { latitude: 40.7128, longitude: -74.006 });

    const res = await request(app)
      .get('/api/maps/users')
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((u: { id: string }) => u.id);
    expect(ids).toContain(peerA.id);
    expect(ids).toContain(peerB.id);
    expect(ids).not.toContain(viewer.id);
  });

  // 6.2 — Ghost Mode ON → user absent de la carte
  it('excludes users who toggled isVisible=false (Ghost Mode)', async () => {
    const viewer = await register(app);
    const ghost = await register(app);
    createdIds.push(viewer.id, ghost.id);

    await makeLiveOnMap(ghost.token, ghost.id, { latitude: 34.0522, longitude: -118.2437 });

    // Ghost Mode ON
    await request(app)
      .patch('/api/users/me/visibility')
      .set('Authorization', `Bearer ${ghost.token}`)
      .send({ isVisible: false });

    const res = await request(app)
      .get('/api/maps/users')
      .set('Authorization', `Bearer ${viewer.token}`);
    const ids = res.body.data.map((u: { id: string }) => u.id);
    expect(ids).not.toContain(ghost.id);
  });

  // 6.x — Users without GPS coords are excluded even if online + visible
  it('excludes users without recorded coords', async () => {
    const viewer = await register(app);
    const noCoords = await register(app);
    createdIds.push(viewer.id, noCoords.id);

    await prisma.user.update({ where: { id: noCoords.id }, data: { isOnline: true } });

    const res = await request(app)
      .get('/api/maps/users')
      .set('Authorization', `Bearer ${viewer.token}`);
    const ids = res.body.data.map((u: { id: string }) => u.id);
    expect(ids).not.toContain(noCoords.id);
  });

  // 6.x — Stale users (lastSeenAt > 30 min ago) are excluded
  it('excludes users whose lastSeenAt is older than 30 min', async () => {
    const viewer = await register(app);
    const stale = await register(app);
    createdIds.push(viewer.id, stale.id);

    const FORTY_MIN_AGO = new Date(Date.now() - 40 * 60 * 1000);
    await prisma.user.update({
      where: { id: stale.id },
      data: {
        isOnline: true,
        latitude: 48.85,
        longitude: 2.35,
        lastSeenAt: FORTY_MIN_AGO,
      },
    });

    const res = await request(app)
      .get('/api/maps/users')
      .set('Authorization', `Bearer ${viewer.token}`);
    const ids = res.body.data.map((u: { id: string }) => u.id);
    expect(ids).not.toContain(stale.id);
  });
});
