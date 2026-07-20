/**
 * Integration tests for the end-to-end house/club INVITATION flow — the
 * feature the QA audit flagged as "morte bout-en-bout" (Bloquant):
 *
 *   POST /clubs/:id/invite  → privileged members mint a signed, shareable
 *                             token + routable URL (and dispatch per-user
 *                             CLUB_INVITE notifications).
 *   POST /clubs/:id/accept  → a recipient joins by presenting EITHER the signed
 *                             token (from a shared link) OR a CLUB_INVITE
 *                             notification. Differentiated failures:
 *                               expired token       → 410 CLUB_008
 *                               invalid/wrong-club   → 403 CLUB_009
 *                               no proof of invite   → 403 CLUB_007
 *                             Idempotent re-accept   → 200 { alreadyMember }.
 *   GET  /clubs/:id         → exposes `viewerInvite` for a pending, real
 *                             CLUB_INVITE so the detail screen can offer an
 *                             "Accept" CTA.
 *
 * Requires the docker Postgres/Redis (same harness as clubs.privacy.test.ts).
 */
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
const { clubInviteToken } =
  require('../src/modules/clubs/clubs.invite-token') as typeof import('../src/modules/clubs/clubs.invite-token');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

const registerUser = async (app: Express) => {
  const username = `ci_${rand()}`;
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
  request(app)
    .post('/api/clubs')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `${name} ${rand()}`, privacy });

describe('Clubs — invitation flow (token + notification accept)', () => {
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

  it('invite mints a signed token + routable URL aligned with the deep-link route', async () => {
    const owner = await registerUser(app);
    const invitee = await registerUser(app);
    createdUserIds.push(owner.id, invitee.id);

    const create = await createClub(app, owner.token, 'PRIVATE', 'Token House');
    const clubId = create.body.data.id as string;
    createdClubIds.push(clubId);

    const res = await request(app)
      .post(`/api/clubs/${clubId}/invite`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userIds: [invitee.id] });

    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(1);
    const { token, url } = res.body.data as { token: string; url: string };
    // The URL must match the `house/:houseId/invite/:token` deep-link route so
    // the shared link is actually routable to HouseInvitationScreen.
    expect(url).toBe(`https://app.chathouse.com/house/${clubId}/invite/${token}`);
    // The token must verify server-side and carry this club's id.
    const verified = clubInviteToken.verify(token);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.claims.clubId).toBe(clubId);
  });

  it('accept-by-token grants entry into a PRIVATE club without a notification', async () => {
    const owner = await registerUser(app);
    const joiner = await registerUser(app);
    createdUserIds.push(owner.id, joiner.id);

    const create = await createClub(app, owner.token, 'PRIVATE', 'Private Accept House');
    const clubId = create.body.data.id as string;
    createdClubIds.push(clubId);

    // Mint a link with an empty target list — no per-user notification for the
    // joiner, so ONLY the token can authorise entry.
    const link = await request(app)
      .post(`/api/clubs/${clubId}/invite`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userIds: [] });
    const token = link.body.data.token as string;

    const accept = await request(app)
      .post(`/api/clubs/${clubId}/accept`)
      .set('Authorization', `Bearer ${joiner.token}`)
      .send({ inviteToken: token });

    expect(accept.status).toBe(200);
    expect(accept.body.data.joined).toBe(true);
    expect(accept.body.data.alreadyMember).toBe(false);

    // The joiner is now really a member (membership row + count reflect it).
    const detail = await request(app)
      .get(`/api/clubs/${clubId}`)
      .set('Authorization', `Bearer ${joiner.token}`);
    expect(detail.body.data.isJoinedByMe).toBe(true);
    expect(detail.body.data.membersCount).toBe(2);
  });

  it('re-accepting is idempotent (already a member, not a 500)', async () => {
    const owner = await registerUser(app);
    const joiner = await registerUser(app);
    createdUserIds.push(owner.id, joiner.id);

    const create = await createClub(app, owner.token, 'PRIVATE', 'Idempotent House');
    const clubId = create.body.data.id as string;
    createdClubIds.push(clubId);

    const link = await request(app)
      .post(`/api/clubs/${clubId}/invite`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userIds: [] });
    const token = link.body.data.token as string;

    await request(app)
      .post(`/api/clubs/${clubId}/accept`)
      .set('Authorization', `Bearer ${joiner.token}`)
      .send({ inviteToken: token });

    const again = await request(app)
      .post(`/api/clubs/${clubId}/accept`)
      .set('Authorization', `Bearer ${joiner.token}`)
      .send({ inviteToken: token });

    expect(again.status).toBe(200);
    expect(again.body.data.joined).toBe(true);
    expect(again.body.data.alreadyMember).toBe(true);
  });

  it('an expired token is rejected with 410 CLUB_008', async () => {
    const owner = await registerUser(app);
    const joiner = await registerUser(app);
    createdUserIds.push(owner.id, joiner.id);

    const create = await createClub(app, owner.token, 'PRIVATE', 'Expired House');
    const clubId = create.body.data.id as string;
    createdClubIds.push(clubId);

    // Mint a token that is already expired (negative ttl).
    const expired = clubInviteToken.sign(clubId, owner.id, -1);

    const accept = await request(app)
      .post(`/api/clubs/${clubId}/accept`)
      .set('Authorization', `Bearer ${joiner.token}`)
      .send({ inviteToken: expired });

    expect(accept.status).toBe(410);
    expect(accept.body.error.code).toBe('CLUB_008');
    // No membership was granted. Private-club metadata is deliberately
    // undiscoverable to a non-member, even after a stale-link attempt.
    const detail = await request(app)
      .get(`/api/clubs/${clubId}`)
      .set('Authorization', `Bearer ${joiner.token}`);
    expect(detail.status).toBe(404);
    expect(detail.body.error.code).toBe('CLUB_001');
  });

  it('a well-signed token for a DIFFERENT club is rejected with 403 CLUB_009', async () => {
    const owner = await registerUser(app);
    const joiner = await registerUser(app);
    createdUserIds.push(owner.id, joiner.id);

    const create = await createClub(app, owner.token, 'PRIVATE', 'Target House');
    const clubId = create.body.data.id as string;
    createdClubIds.push(clubId);

    // Valid signature, but bound to some OTHER club id — must not open this one.
    const otherClubToken = clubInviteToken.sign('some-other-club', owner.id);

    const accept = await request(app)
      .post(`/api/clubs/${clubId}/accept`)
      .set('Authorization', `Bearer ${joiner.token}`)
      .send({ inviteToken: otherClubToken });

    expect(accept.status).toBe(403);
    expect(accept.body.error.code).toBe('CLUB_009');
  });

  it('accept with NO token and NO notification is rejected with 403 CLUB_007', async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    createdUserIds.push(owner.id, stranger.id);

    const create = await createClub(app, owner.token, 'PRIVATE', 'No-Proof House');
    const clubId = create.body.data.id as string;
    createdClubIds.push(clubId);

    const accept = await request(app)
      .post(`/api/clubs/${clubId}/accept`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({});

    expect(accept.status).toBe(403);
    expect(accept.body.error.code).toBe('CLUB_007');
  });

  it('a plain MEMBER cannot invite (CLUB_002); only owner/admin/moderator may', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app);
    const target = await registerUser(app);
    createdUserIds.push(owner.id, member.id, target.id);

    const create = await createClub(app, owner.token, 'OPEN', 'Open Invite House');
    const clubId = create.body.data.id as string;
    createdClubIds.push(clubId);

    // The member joins the OPEN club directly, then tries to invite — a plain
    // MEMBER must be refused so they can't pull arbitrary users into a club.
    await request(app)
      .post(`/api/clubs/${clubId}/join`)
      .set('Authorization', `Bearer ${member.token}`);

    const asMember = await request(app)
      .post(`/api/clubs/${clubId}/invite`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ userIds: [target.id] });
    expect(asMember.status).toBe(403);
    expect(asMember.body.error.code).toBe('CLUB_002');
  });

  it('GET /clubs/:id exposes viewerInvite for a pending CLUB_INVITE, cleared once joined', async () => {
    const owner = await registerUser(app);
    const invitee = await registerUser(app);
    createdUserIds.push(owner.id, invitee.id);

    const create = await createClub(app, owner.token, 'PRIVATE', 'ViewerInvite House');
    const clubId = create.body.data.id as string;
    createdClubIds.push(clubId);

    // Owner invites the user directly → creates a CLUB_INVITE notification.
    await request(app)
      .post(`/api/clubs/${clubId}/invite`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userIds: [invitee.id] });

    // Before accepting, the invitee's detail view surfaces a pending invite.
    const before = await request(app)
      .get(`/api/clubs/${clubId}`)
      .set('Authorization', `Bearer ${invitee.token}`);
    expect(before.status).toBe(200);
    expect(before.body.data.viewerInvite).toBeTruthy();
    expect(before.body.data.viewerInvite.pending).toBe(true);
    expect(before.body.data.viewerInvite.inviterId).toBe(owner.id);

    // Accept via the notification (no token) — the notification alone authorises.
    const accept = await request(app)
      .post(`/api/clubs/${clubId}/accept`)
      .set('Authorization', `Bearer ${invitee.token}`)
      .send({});
    expect(accept.status).toBe(200);
    expect(accept.body.data.joined).toBe(true);

    // Once a member, viewerInvite is null (nothing left to accept).
    const after = await request(app)
      .get(`/api/clubs/${clubId}`)
      .set('Authorization', `Bearer ${invitee.token}`);
    expect(after.body.data.isJoinedByMe).toBe(true);
    expect(after.body.data.viewerInvite).toBeNull();
  });
});
