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
const { notificationsService } =
  require('../src/modules/notifications/notifications.service') as typeof import('../src/modules/notifications/notifications.service');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

const registerUser = async (app: Express) => {
  const username = `f_${rand()}`;
  const email = `${username}@test.local`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, email, password: 'test-password-123' });
  return {
    id: res.body.data.user.id as string,
    username,
    token: res.body.data.accessToken as string,
  };
};

describe('Follow integration', () => {
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

  it('follow → followers list → unfollow round-trip', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    createdIds.push(alice.id, bob.id);

    // Alice follows Bob
    const follow = await request(app)
      .post(`/api/follow/${bob.id}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(follow.status).toBe(200);
    expect(follow.body.data.following).toBe(true);

    // Duplicate follow is idempotent, still 200
    const again = await request(app)
      .post(`/api/follow/${bob.id}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(again.status).toBe(200);

    // Bob sees Alice in his followers
    const bobFollowers = await request(app)
      .get('/api/follow/followers')
      .set('Authorization', `Bearer ${bob.token}`);
    expect(bobFollowers.status).toBe(200);
    // listFollowers returns a cursor page: { data: [...], nextCursor }, wrapped
    // by sendOk into body.data — so the users array is body.data.data.
    expect(bobFollowers.body.data.data.map((u: { id: string }) => u.id)).toContain(alice.id);

    // Alice sees Bob in her following list
    const aliceFollowing = await request(app)
      .get('/api/follow/following')
      .set('Authorization', `Bearer ${alice.token}`);
    expect(aliceFollowing.body.data.data.map((u: { id: string }) => u.id)).toContain(bob.id);

    // Alice cannot follow herself
    const selfFollow = await request(app)
      .post(`/api/follow/${alice.id}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(selfFollow.status).toBe(403);
    expect(selfFollow.body.error.code).toBe('USER_003');

    // Unfollow
    const unfollow = await request(app)
      .delete(`/api/follow/${bob.id}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(unfollow.status).toBe(200);
    expect(unfollow.body.data.following).toBe(false);
  });

  it('following list exposes DM eligibility without leaking recipient privacy', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    createdIds.push(alice.id, bob.id);

    await request(app).post(`/api/follow/${bob.id}`).set('Authorization', `Bearer ${alice.token}`);

    const candidate = async () => {
      const response = await request(app)
        .get('/api/follow/following')
        .set('Authorization', `Bearer ${alice.token}`);
      expect(response.status).toBe(200);
      return response.body.data.data.find((user: { id: string }) => user.id === bob.id) as {
        id: string;
        canDirectMessage: boolean;
        dmPrivacy?: string;
      };
    };

    // Default privacy is mutual: Alice follows Bob, but Bob does not follow
    // Alice yet, so the compose screen must prevent the known-denied DM.
    expect(await candidate()).toMatchObject({ id: bob.id, canDirectMessage: false });

    // "followers" means people following Bob may write to him.
    await prisma.user.update({ where: { id: bob.id }, data: { dmPrivacy: 'followers' } });
    expect((await candidate()).canDirectMessage).toBe(true);

    await prisma.user.update({ where: { id: bob.id }, data: { dmPrivacy: 'nobody' } });
    expect((await candidate()).canDirectMessage).toBe(false);

    await prisma.user.update({ where: { id: bob.id }, data: { dmPrivacy: 'everyone' } });
    const openCandidate = await candidate();
    expect(openCandidate.canDirectMessage).toBe(true);
    expect(openCandidate).not.toHaveProperty('dmPrivacy');

    // Back under mutual privacy, a reciprocal accepted follow enables the DM.
    await prisma.user.update({ where: { id: bob.id }, data: { dmPrivacy: 'mutual' } });
    await request(app).post(`/api/follow/${alice.id}`).set('Authorization', `Bearer ${bob.token}`);
    expect((await candidate()).canDirectMessage).toBe(true);
  });

  it('runs the private-account request lifecycle and preserves viewer-safe profile state', async () => {
    const requester = await registerUser(app);
    const target = await registerUser(app);
    const outsider = await registerUser(app);
    createdIds.push(requester.id, target.id, outsider.id);
    await prisma.user.update({ where: { id: target.id }, data: { isPrivateAccount: true } });

    const follow = await request(app)
      .post(`/api/follow/${target.id}`)
      .set('Authorization', `Bearer ${requester.token}`);
    expect(follow.status).toBe(200);
    expect(follow.body.data).toEqual({ following: false, requested: true });

    const pendingProfile = await request(app)
      .get(`/api/users/${target.id}`)
      .set('Authorization', `Bearer ${requester.token}`);
    expect(pendingProfile.body.data).toMatchObject({
      isFollowedByMe: false,
      followRequestedByMe: true,
    });
    const outsiderProfile = await request(app)
      .get(`/api/users/${target.id}`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(outsiderProfile.body.data).toMatchObject({
      isFollowedByMe: false,
      followRequestedByMe: false,
    });

    // The same requester-owned state is available on actionable follow-list
    // rows, without exposing it to another viewer.
    await request(app)
      .post(`/api/follow/${outsider.id}`)
      .set('Authorization', `Bearer ${target.token}`);
    const requesterViewOfList = await request(app)
      .get(`/api/follow/${outsider.id}/followers`)
      .set('Authorization', `Bearer ${requester.token}`);
    expect(
      requesterViewOfList.body.data.data.find((user: { id: string }) => user.id === target.id),
    ).toMatchObject({ isFollowedByMe: false, followRequestedByMe: true });
    const outsiderViewOfList = await request(app)
      .get(`/api/follow/${outsider.id}/followers`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(
      outsiderViewOfList.body.data.data.find((user: { id: string }) => user.id === target.id),
    ).toMatchObject({ followRequestedByMe: false });

    const inbox = await request(app)
      .get('/api/follow/requests?limit=1')
      .set('Authorization', `Bearer ${target.token}`);
    expect(inbox.status).toBe(200);
    expect(inbox.body.data.data).toEqual([
      expect.objectContaining({ id: requester.id, username: requester.username }),
    ]);

    const social = await request(app)
      .get('/api/notifications?filter=social')
      .set('Authorization', `Bearer ${target.token}`);
    expect(social.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'FOLLOW_REQUEST', actorId: requester.id }),
      ]),
    );

    // Prime the Redis count before the domain transaction deletes the row.
    const unreadBefore = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${target.token}`);
    const accept = await request(app)
      .post(`/api/follow/${requester.id}/accept`)
      .set('Authorization', `Bearer ${target.token}`);
    expect(accept.status).toBe(200);
    expect(accept.body.data).toEqual({ accepted: true });

    const unreadAfter = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${target.token}`);
    expect(unreadAfter.body.data.count).toBe(unreadBefore.body.data.count - 1);

    const acceptedProfile = await request(app)
      .get(`/api/users/${target.id}`)
      .set('Authorization', `Bearer ${requester.token}`);
    expect(acceptedProfile.body.data).toMatchObject({
      isFollowedByMe: true,
      followRequestedByMe: false,
    });
    const emptyInbox = await request(app)
      .get('/api/follow/requests')
      .set('Authorization', `Bearer ${target.token}`);
    expect(emptyInbox.body.data.data).toEqual([]);

    // Accept replay is idempotent: counters are not bumped twice.
    const countsBeforeReplay = await prisma.user.findUniqueOrThrow({
      where: { id: target.id },
      select: { followerCount: true },
    });
    const replay = await request(app)
      .post(`/api/follow/${requester.id}/accept`)
      .set('Authorization', `Bearer ${target.token}`);
    expect(replay.status).toBe(200);
    const countsAfterReplay = await prisma.user.findUniqueOrThrow({
      where: { id: target.id },
      select: { followerCount: true },
    });
    expect(countsAfterReplay.followerCount).toBe(countsBeforeReplay.followerCount);

    // Reject and requester-side cancellation both clear pending state and the
    // cached unread badge without touching accepted counters.
    await request(app)
      .post(`/api/follow/${target.id}`)
      .set('Authorization', `Bearer ${outsider.token}`);
    const reject = await request(app)
      .post(`/api/follow/${outsider.id}/reject`)
      .set('Authorization', `Bearer ${target.token}`);
    expect(reject.body.data).toEqual({ rejected: true });
    const rejectedAgain = await request(app)
      .post(`/api/follow/${outsider.id}/reject`)
      .set('Authorization', `Bearer ${target.token}`);
    expect(rejectedAgain.body.data).toEqual({ rejected: false });

    await request(app)
      .post(`/api/follow/${target.id}`)
      .set('Authorization', `Bearer ${outsider.token}`);
    const cancel = await request(app)
      .delete(`/api/follow/${target.id}`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(cancel.body.data).toEqual({ following: false });
    const cancelledProfile = await request(app)
      .get(`/api/users/${target.id}`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(cancelledProfile.body.data.followRequestedByMe).toBe(false);
  });

  it('keeps the atomic follow request durable and idempotent when post-commit fanout fails', async () => {
    const requester = await registerUser(app);
    const target = await registerUser(app);
    createdIds.push(requester.id, target.id);
    await prisma.user.update({
      where: { id: target.id },
      data: { isPrivateAccount: true },
    });

    const fanout = jest
      .spyOn(notificationsService, 'deliverPersisted')
      .mockRejectedValueOnce(new Error('simulated delivery outage'));
    try {
      const first = await request(app)
        .post(`/api/follow/${target.id}`)
        .set('Authorization', `Bearer ${requester.token}`);
      expect(first.status).toBe(200);
      expect(first.body.data).toEqual({ following: false, requested: true });

      const replay = await request(app)
        .post(`/api/follow/${target.id}`)
        .set('Authorization', `Bearer ${requester.token}`);
      expect(replay.status).toBe(200);
      expect(replay.body.data).toEqual({ following: false, requested: true });

      expect(
        await prisma.follow.count({
          where: { followerId: requester.id, followingId: target.id, status: 'PENDING' },
        }),
      ).toBe(1);
      expect(
        await prisma.notification.count({
          where: {
            userId: target.id,
            actorId: requester.id,
            type: 'FOLLOW_REQUEST',
          },
        }),
      ).toBe(1);
      expect(fanout).toHaveBeenCalledTimes(1);
      expect(fanout).toHaveBeenCalledWith(
        expect.objectContaining({ userId: target.id, actorId: requester.id }),
        { verifyExists: true },
      );
    } finally {
      fanout.mockRestore();
    }
  });

  it('paginates equal-timestamp private follow requests without skips or duplicates', async () => {
    const target = await registerUser(app);
    const requesters = await Promise.all(Array.from({ length: 3 }, () => registerUser(app)));
    createdIds.push(target.id, ...requesters.map(user => user.id));
    const createdAt = new Date('2031-01-01T00:00:00.000Z');
    const edges = await Promise.all(
      requesters.map(requester =>
        prisma.follow.create({
          data: {
            followerId: requester.id,
            followingId: target.id,
            status: 'PENDING',
            createdAt,
          },
          select: { id: true, followerId: true },
        }),
      ),
    );

    const first = await request(app)
      .get('/api/follow/requests?limit=2')
      .set('Authorization', `Bearer ${target.token}`);
    expect(first.body.data.nextCursor).toMatch(/^v1\./);
    const second = await request(app)
      .get('/api/follow/requests')
      .query({ limit: 2, cursor: first.body.data.nextCursor as string })
      .set('Authorization', `Bearer ${target.token}`);

    const actual = [...first.body.data.data, ...second.body.data.data].map(
      (user: { id: string }) => user.id,
    );
    const expected = [...edges]
      .sort((left, right) => right.id.localeCompare(left.id))
      .map(edge => edge.followerId);
    expect(actual).toEqual(expected);
    expect(new Set(actual)).toHaveProperty('size', 3);
  });

  it('paginates equal-timestamp follow edges without skips or duplicates', async () => {
    const target = await registerUser(app);
    const actors = await Promise.all(Array.from({ length: 3 }, () => registerUser(app)));
    createdIds.push(target.id, ...actors.map(actor => actor.id));
    const createdAt = new Date('2030-01-01T00:00:00.000Z');
    const suffix = rand();
    const relations = actors.map((actor, index) => ({
      id: `follow-${index}-${suffix}`,
      followerId: actor.id,
      followingId: target.id,
      status: 'ACCEPTED' as const,
      createdAt,
    }));
    await prisma.follow.createMany({ data: relations });

    const first = await request(app)
      .get(`/api/follow/${target.id}/followers?limit=2`)
      .set('Authorization', `Bearer ${target.token}`);
    expect(first.status).toBe(200);
    expect(first.body.data.hasMore).toBe(true);
    expect(first.body.data.nextCursor).toMatch(/^v1\./);

    const second = await request(app)
      .get(`/api/follow/${target.id}/followers`)
      .query({ limit: 2, cursor: first.body.data.nextCursor as string })
      .set('Authorization', `Bearer ${target.token}`);
    expect(second.status).toBe(200);

    const actual = [...first.body.data.data, ...second.body.data.data].map(
      (user: { id: string }) => user.id,
    );
    const expected = [...relations]
      .sort((left, right) => right.id.localeCompare(left.id))
      .map(relation => relation.followerId);
    expect(actual).toEqual(expected);
    expect(new Set(actual).size).toBe(actors.length);
  });

  it.each(['/api/follow/followers', '/api/follow/following', '/api/follow/requests'])(
    'returns 400 for a malformed cursor on %s',
    async path => {
      const user = await registerUser(app);
      createdIds.push(user.id);
      const response = await request(app)
        .get(`${path}?cursor=not-a-cursor`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_001');
    },
  );
});
