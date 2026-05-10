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
const { ensureSearchIndexes } =
  require('../src/config/searchIndexes') as typeof import('../src/config/searchIndexes');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

const registerUser = async (app: Express, prefix: string) => {
  const username = `${prefix}_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      username,
      email: `${username}@test.local`,
      password: 'test-password-123',
    });
  return {
    id: res.body.data.user.id as string,
    username,
    token: res.body.data.accessToken as string,
  };
};

describe('Search + Explore integration', () => {
  let app: Express;
  const createdUserIds: string[] = [];
  const createdClubIds: string[] = [];
  const createdRoomIds: string[] = [];

  // Unique marker so search queries don't collide with other suites'
  // leftover data. 8 chars of randomness.
  const marker = `zqx${rand()}`;

  beforeAll(async () => {
    await connectRedis();
    // Ensure pg_trgm extension + indexes exist for this suite. Idempotent,
    // so repeated runs are safe.
    await ensureSearchIndexes();
    app = createApp();
  });

  afterAll(async () => {
    for (const id of createdRoomIds) {
      await prisma.room.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdClubIds) {
      await prisma.club.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdUserIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('search?type=all returns users/clubs/rooms matching the marker', async () => {
    const host = await registerUser(app, `se${marker}`);
    const viewer = await registerUser(app, `vw${marker}`);
    createdUserIds.push(host.id, viewer.id);

    // Give the host a bio that also contains the marker so the user
    // search hits the trigram index on bio too. Search is run from a
    // separate viewer account — the searcher never appears in their
    // own user results.
    await prisma.user.update({
      where: { id: host.id },
      data: { bio: `Expert in ${marker}` },
    });

    const clubRes = await request(app)
      .post('/api/clubs')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ name: `${marker} club`, description: 'searchable club', privacy: 'OPEN' });
    const clubId = clubRes.body.data.id as string;
    createdClubIds.push(clubId);

    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: `Live ${marker} stream`, topic: 'tech' });
    createdRoomIds.push(roomRes.body.data.id);

    const res = await request(app)
      .get(`/api/search?q=${marker}&type=all`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(res.status).toBe(200);
    const data = res.body.data as {
      users: { id: string }[];
      clubs: { id: string }[];
      rooms: { id: string }[];
    };
    expect(data.users.some(u => u.id === host.id)).toBe(true);
    expect(data.clubs.some(c => c.id === clubId)).toBe(true);
    expect(data.rooms.some(r => r.id === roomRes.body.data.id)).toBe(true);
  });

  it('search?type=users hits username / displayName / bio', async () => {
    const u1 = await registerUser(app, `us${marker}`);
    const u2 = await registerUser(app, 'plain');
    const viewer = await registerUser(app, `vw${marker}b`);
    createdUserIds.push(u1.id, u2.id, viewer.id);

    // u2's bio contains the marker; username does not — the bio branch
    // of the OR still lands them in the results. Search from a separate
    // viewer so both u1 (via username) and u2 (via bio) appear.
    await prisma.user.update({
      where: { id: u2.id },
      data: { bio: `talks a lot about ${marker}` },
    });

    const res = await request(app)
      .get(`/api/search?q=${marker}&type=users`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.users.map((u: { id: string }) => u.id);
    expect(ids).toEqual(expect.arrayContaining([u1.id, u2.id]));
  });

  it('rejects empty q (VALIDATION_001)', async () => {
    const u = await registerUser(app, 'empty');
    createdUserIds.push(u.id);
    const res = await request(app).get('/api/search?q=').set('Authorization', `Bearer ${u.token}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_001');
  });

  it('explore returns trending rooms/clubs and featured users', async () => {
    const viewer = await registerUser(app, 'viewer');
    const other = await registerUser(app, 'other');
    createdUserIds.push(viewer.id, other.id);

    // Give "other" a follower so they rank via followers desc, and mark
    // them recently active so they fall inside the 14-day featured window.
    await prisma.follow.create({
      data: { followerId: viewer.id, followingId: other.id },
    });
    await prisma.user.update({
      where: { id: other.id },
      data: { lastSeenAt: new Date() },
    });

    const clubRes = await request(app)
      .post('/api/clubs')
      .set('Authorization', `Bearer ${other.token}`)
      .send({ name: 'Explore Club', privacy: 'OPEN' });
    createdClubIds.push(clubRes.body.data.id);

    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${other.token}`)
      .send({ title: 'Explore live room' });
    createdRoomIds.push(roomRes.body.data.id);

    const res = await request(app)
      .get('/api/explore')
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(res.status).toBe(200);
    const body = res.body.data as {
      rooms: { id: string }[];
      clubs: { id: string }[];
      users: { id: string }[];
    };

    expect(body.rooms.some(r => r.id === roomRes.body.data.id)).toBe(true);
    expect(body.clubs.some(c => c.id === clubRes.body.data.id)).toBe(true);
    // `other` should appear since they have 1 follower (viewer). The viewer
    // themselves must NOT appear in their own feed.
    expect(body.users.some(u => u.id === other.id)).toBe(true);
    expect(body.users.some(u => u.id === viewer.id)).toBe(false);
  });

  it('explore hides PRIVATE clubs from trending', async () => {
    const viewer = await registerUser(app, 'privv');
    createdUserIds.push(viewer.id);

    const privClub = await request(app)
      .post('/api/clubs')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ name: 'Hidden House', privacy: 'PRIVATE' });
    createdClubIds.push(privClub.body.data.id);

    const res = await request(app)
      .get('/api/explore')
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(res.status).toBe(200);
    const clubIds = res.body.data.clubs.map((c: { id: string }) => c.id);
    expect(clubIds).not.toContain(privClub.body.data.id);
  });
});
