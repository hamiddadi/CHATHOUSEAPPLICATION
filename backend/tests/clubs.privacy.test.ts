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
  const username = `cp_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, email: `${username}@test.local`, password: 'test-password-123' });
  return { id: res.body.data.user.id as string, token: res.body.data.accessToken as string };
};

const createClub = (
  app: Express,
  token: string,
  privacy: 'OPEN' | 'PRIVATE' | 'SOCIAL',
  name: string,
) =>
  request(app).post('/api/clubs').set('Authorization', `Bearer ${token}`).send({ name, privacy });

describe('Clubs — PRIVATE member-roster privacy gate', () => {
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

  it('PRIVATE house: an uninvited non-member cannot enumerate it by id', async () => {
    const owner = await registerUser(app);
    const outsider = await registerUser(app);
    createdUserIds.push(owner.id, outsider.id);

    const create = await createClub(app, owner.token, 'PRIVATE', 'Secret House');
    const clubId = create.body.data.id as string;
    createdClubIds.push(clubId);

    const asOutsider = await request(app)
      .get(`/api/clubs/${clubId}`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(asOutsider.status).toBe(404);
    expect(asOutsider.body.error.code).toBe('CLUB_001');
  });

  it('PRIVATE house: a signed invite permits a preview without exposing the roster', async () => {
    const owner = await registerUser(app);
    const invitee = await registerUser(app);
    createdUserIds.push(owner.id, invitee.id);

    const create = await createClub(app, owner.token, 'PRIVATE', `Invite House ${rand()}`);
    const clubId = create.body.data.id as string;
    createdClubIds.push(clubId);

    const invite = await request(app)
      .post(`/api/clubs/${clubId}/invite`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userIds: [] });
    const preview = await request(app)
      .get(`/api/clubs/${clubId}`)
      .set('Authorization', `Bearer ${invitee.token}`)
      .set('X-House-Invite', invite.body.data.token as string);

    expect(preview.status).toBe(200);
    expect(preview.body.data.name).toContain('Invite House');
    expect(preview.body.data.members).toEqual([]);
    expect(preview.body.data.membersCount).toBe(1);
    expect(preview.body.data.isJoinedByMe).toBe(false);
  });

  it('PRIVATE house: the owner (a member) still sees the full member list', async () => {
    const owner = await registerUser(app);
    createdUserIds.push(owner.id);

    const create = await createClub(app, owner.token, 'PRIVATE', 'Owner House');
    const clubId = create.body.data.id as string;
    createdClubIds.push(clubId);

    const asOwner = await request(app)
      .get(`/api/clubs/${clubId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.data.members).toHaveLength(1);
    expect(asOwner.body.data.members[0].id).toBe(owner.id);
    expect(asOwner.body.data.isJoinedByMe).toBe(true);
  });

  it('OPEN house: the member list stays public to non-members', async () => {
    const owner = await registerUser(app);
    const outsider = await registerUser(app);
    createdUserIds.push(owner.id, outsider.id);

    const create = await createClub(app, owner.token, 'OPEN', 'Open House');
    const clubId = create.body.data.id as string;
    createdClubIds.push(clubId);

    const asOutsider = await request(app)
      .get(`/api/clubs/${clubId}`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(asOutsider.status).toBe(200);
    expect(asOutsider.body.data.members).toHaveLength(1);
    expect(asOutsider.body.data.members[0].id).toBe(owner.id);
  });

  it('PRIVATE house: a member beyond the take:100 window still sees the roster and finds their own row', async () => {
    // REGRESSION GUARD. `clubInclude.take = 100` (orderBy joinedAt asc) truncates
    // the roster. Before the fix, `isJoinedByMe` was derived from that slice, so a
    // member joining after the 100th oldest was treated as a non-member: their own
    // PRIVATE roster came back empty and their admin/moderator CTAs vanished.
    const owner = await registerUser(app);
    const viewer = await registerUser(app);
    createdUserIds.push(owner.id, viewer.id);

    const create = await createClub(app, owner.token, 'PRIVATE', `Big House ${rand()}`);
    const clubId = create.body.data.id as string;
    createdClubIds.push(clubId);

    // Owner is member #1 (oldest). Bulk-seed 100 filler members strictly older
    // than the viewer, then add the viewer with the newest joinedAt so they land
    // beyond the take:100 asc window. Seeded directly via Prisma — 100 HTTP
    // registrations would be far too slow — but the GET below still exercises
    // the real service/DB read path (resolveViewerMembership on the unique index).
    const base = Date.now();
    for (let i = 0; i < 100; i++) {
      const filler = await prisma.user.create({
        data: { username: `cp_fill_${rand()}_${i}` },
      });
      createdUserIds.push(filler.id);
      await prisma.clubMember.create({
        data: {
          clubId,
          userId: filler.id,
          role: 'MEMBER',
          joinedAt: new Date(base + (i + 1) * 1000),
        },
      });
    }
    // Viewer joins last → newest joinedAt → excluded from the take:100 slice.
    await prisma.clubMember.create({
      data: {
        clubId,
        userId: viewer.id,
        role: 'MODERATOR',
        joinedAt: new Date(base + 1_000_000),
      },
    });
    await prisma.club.update({
      where: { id: clubId },
      data: { memberCount: { increment: 101 } },
    });

    const asViewer = await request(app)
      .get(`/api/clubs/${clubId}`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(asViewer.status).toBe(200);
    // Membership is now derived authoritatively, independent of the slice.
    expect(asViewer.body.data.isJoinedByMe).toBe(true);
    // The PRIVATE roster is served (canSeeMembers true) — not the empty array.
    expect(asViewer.body.data.members.length).toBeGreaterThan(0);
    // The viewer's own row is merged in so FE role-derivation works.
    const self = asViewer.body.data.members.find((m: { id: string }) => m.id === viewer.id);
    expect(self).toBeDefined();
    expect(self.role).toBe('moderator');
    // The authoritative aggregate count reflects all 102 members (owner + 100 + viewer).
    expect(asViewer.body.data.membersCount).toBe(102);
  });
});
