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

const registerUser = async (app: Express) => {
  const username = `c_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, email: `${username}@test.local`, password: 'test-password-123' });
  return {
    id: res.body.data.user.id as string,
    username,
    token: res.body.data.accessToken as string,
  };
};

describe('Clubs integration — create / list / join / leave / invite', () => {
  let app: Express;
  const createdUserIds: string[] = [];
  const createdClubIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    for (const id of createdClubIds) {
      await prisma.club.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdUserIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('owner creates club → is admin member, appears in "mine", not in "discover"', async () => {
    const owner = await registerUser(app);
    createdUserIds.push(owner.id);

    const create = await request(app)
      .post('/api/clubs')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Tech Talks', description: 'Weekly tech chat', privacy: 'OPEN' });
    expect(create.status).toBe(201);
    const clubId = create.body.data.id as string;
    createdClubIds.push(clubId);

    expect(create.body.data.name).toBe('Tech Talks');
    expect(create.body.data.privacy).toBe('open');
    expect(create.body.data.isJoinedByMe).toBe(true);
    expect(create.body.data.members).toHaveLength(1);
    expect(create.body.data.members[0].role).toBe('admin');
    expect(create.body.data.membersCount).toBe(1);

    const mine = await request(app)
      .get('/api/clubs?filter=mine')
      .set('Authorization', `Bearer ${owner.token}`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.some((c: { id: string }) => c.id === clubId)).toBe(true);

    const discover = await request(app)
      .get('/api/clubs?filter=discover')
      .set('Authorization', `Bearer ${owner.token}`);
    expect(discover.body.data.some((c: { id: string }) => c.id === clubId)).toBe(false);
  });

  it('stranger can join OPEN club, then leave', async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    createdUserIds.push(owner.id, stranger.id);

    const create = await request(app)
      .post('/api/clubs')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Open House', privacy: 'OPEN' });
    const clubId = create.body.data.id as string;
    createdClubIds.push(clubId);

    // Before joining: club appears in stranger's "discover".
    const discoverBefore = await request(app)
      .get('/api/clubs?filter=discover')
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(discoverBefore.body.data.some((c: { id: string }) => c.id === clubId)).toBe(true);

    const join = await request(app)
      .post(`/api/clubs/${clubId}/join`)
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(join.status).toBe(200);
    expect(join.body.data.joined).toBe(true);

    // Double-join → 409 CLUB_004
    const dup = await request(app)
      .post(`/api/clubs/${clubId}/join`)
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CLUB_004');

    const detail = await request(app)
      .get(`/api/clubs/${clubId}`)
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(detail.body.data.membersCount).toBe(2);
    expect(detail.body.data.isJoinedByMe).toBe(true);

    const leave = await request(app)
      .post(`/api/clubs/${clubId}/leave`)
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(leave.status).toBe(200);
    expect(leave.body.data.left).toBe(true);
  });

  it('owner cannot leave their own club (CLUB_005)', async () => {
    const owner = await registerUser(app);
    createdUserIds.push(owner.id);
    const create = await request(app)
      .post('/api/clubs')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Solo House', privacy: 'OPEN' });
    const clubId = create.body.data.id as string;
    createdClubIds.push(clubId);

    const leave = await request(app)
      .post(`/api/clubs/${clubId}/leave`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(leave.status).toBe(403);
    expect(leave.body.error.code).toBe('CLUB_005');
  });

  it('PRIVATE club blocks direct join (CLUB_003) but invite creates a notification the invitee can accept', async () => {
    const owner = await registerUser(app);
    const friend = await registerUser(app);
    createdUserIds.push(owner.id, friend.id);

    const create = await request(app)
      .post('/api/clubs')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Secret House', privacy: 'PRIVATE' });
    const clubId = create.body.data.id as string;
    createdClubIds.push(clubId);

    const blocked = await request(app)
      .post(`/api/clubs/${clubId}/join`)
      .set('Authorization', `Bearer ${friend.token}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('CLUB_003');

    const invite = await request(app)
      .post(`/api/clubs/${clubId}/invite`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userIds: [friend.id] });
    expect(invite.status).toBe(200);
    expect(invite.body.data.sent).toBe(1);

    // Notification row exists for the invitee.
    const notifs = await prisma.notification.findMany({
      where: { userId: friend.id, type: 'CLUB_INVITE' },
    });
    expect(notifs.length).toBeGreaterThanOrEqual(1);

    // Accept bypasses the privacy gate.
    const accept = await request(app)
      .post(`/api/clubs/${clubId}/accept`)
      .set('Authorization', `Bearer ${friend.token}`);
    expect(accept.status).toBe(200);
    expect(accept.body.data.joined).toBe(true);

    const detail = await request(app)
      .get(`/api/clubs/${clubId}`)
      .set('Authorization', `Bearer ${friend.token}`);
    expect(detail.body.data.isJoinedByMe).toBe(true);
    expect(detail.body.data.membersCount).toBe(2);
  });

  it('non-member cannot invite (CLUB_002)', async () => {
    const owner = await registerUser(app);
    const outsider = await registerUser(app);
    const target = await registerUser(app);
    createdUserIds.push(owner.id, outsider.id, target.id);

    const create = await request(app)
      .post('/api/clubs')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Closed club', privacy: 'OPEN' });
    const clubId = create.body.data.id as string;
    createdClubIds.push(clubId);

    const invite = await request(app)
      .post(`/api/clubs/${clubId}/invite`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ userIds: [target.id] });
    expect(invite.status).toBe(403);
    expect(invite.body.error.code).toBe('CLUB_002');
  });

  it('validates create payload (VALIDATION_001 on too-short name)', async () => {
    const owner = await registerUser(app);
    createdUserIds.push(owner.id);

    const res = await request(app)
      .post('/api/clubs')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_001');
  });
});
