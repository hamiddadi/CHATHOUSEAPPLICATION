import { randomUUID } from 'node:crypto';
import { prisma } from '../src/config/database';
import { connectRedis, disconnectRedis, redis } from '../src/config/redis';
import { audioService } from '../src/extensions/modules/audio/audio.service';
import { profileLinksService } from '../src/extensions/modules/profileLinks/profileLinks.service';
import { notificationsService } from '../src/modules/notifications/notifications.service';
import { registerOutboxHandler } from '../src/workers/outbox.worker';
import {
  hardDeleteUserWithRelationalRepair,
  reconcileDenormalizedCounts,
} from '../src/workers/gdpr-purge.worker';

const suffix = (): string => randomUUID().replace(/-/g, '').slice(0, 12);
const makeUser = async (premium = false) =>
  prisma.user.create({
    data: { username: `data_${suffix()}`, isPremium: premium },
    select: { id: true },
  });

describe('relational extension cut-over and integrity', () => {
  const userIds = new Set<string>();

  beforeAll(async () => connectRedis());

  afterEach(async () => {
    if (userIds.size > 0) {
      await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
      userIds.clear();
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('marks an empty legacy value and never reads Redis again', async () => {
    const user = await makeUser();
    userIds.add(user.id);
    const key = `ext:profile:links:${user.id}`;
    await redis.del(key);

    expect(await profileLinksService.list(user.id)).toEqual([]);
    expect(
      await prisma.userExtensionImport.findUnique({
        where: { userId_namespace: { userId: user.id, namespace: 'profile-links-v1' } },
      }),
    ).not.toBeNull();

    await redis.set(
      key,
      JSON.stringify([{ id: 'late-link', label: 'Late', url: 'https://late.example' }]),
    );
    expect(await profileLinksService.list(user.id)).toEqual([]);
    await redis.del(key);
  });

  it('fails closed when Redis is unavailable without recording an import marker', async () => {
    const user = await makeUser();
    userIds.add(user.id);
    const getSpy = jest.spyOn(redis, 'get').mockRejectedValueOnce(new Error('legacy store down'));

    await expect(audioService.get(user.id)).rejects.toThrow('legacy store down');
    expect(
      await prisma.userExtensionImport.findUnique({
        where: {
          userId_namespace: { userId: user.id, namespace: 'audio-preferences-v1' },
        },
      }),
    ).toBeNull();
    getSpy.mockRestore();
  });

  it('serializes concurrent first access and preserves PostgreSQL authority', async () => {
    const user = await makeUser();
    userIds.add(user.id);
    const key = `ext:audio:prefs:${user.id}`;
    await redis.set(key, JSON.stringify({ qualityTier: 'high', spatialAudio: true }));

    const values = await Promise.all(Array.from({ length: 6 }, () => audioService.get(user.id)));
    expect(values.every(value => value.qualityTier === 'high' && value.spatialAudio)).toBe(true);
    expect(
      await prisma.userExtensionImport.count({
        where: { userId: user.id, namespace: 'audio-preferences-v1' },
      }),
    ).toBe(1);

    await audioService.update(user.id, { qualityTier: 'music', spatialAudio: false });
    await redis.set(key, JSON.stringify({ qualityTier: 'standard', spatialAudio: true }));
    expect(await audioService.get(user.id)).toMatchObject({
      qualityTier: 'music',
      spatialAudio: false,
    });
    await redis.del(key);
  });

  it('enforces the profile-link cap under concurrent writes', async () => {
    const user = await makeUser(true);
    userIds.add(user.id);
    await redis.del(`ext:profile:links:${user.id}`);

    const settled = await Promise.allSettled(
      Array.from({ length: 9 }, (_, index) =>
        profileLinksService.add(user.id, {
          label: `Link ${index}`,
          url: `https://example${index}.test`,
        }),
      ),
    );
    expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(5);
    expect(await prisma.profileLink.count({ where: { userId: user.id } })).toBe(5);
  });

  it('atomically deduplicates a notification and its outbox envelope', async () => {
    const user = await makeUser();
    userIds.add(user.id);
    const dedupeKey = `test-notification:${suffix()}`;
    const unregister = registerOutboxHandler('notification.deliver', async () => undefined);
    try {
      const first = await notificationsService.create({
        userId: user.id,
        type: 'WAVE',
        title: 'Wave',
        body: 'Hello',
        dedupeKey,
      });
      const second = await notificationsService.create({
        userId: user.id,
        type: 'WAVE',
        title: 'Wave',
        body: 'Hello',
        dedupeKey,
      });
      expect(second.id).toBe(first.id);
      expect(await prisma.notification.count({ where: { dedupeKey } })).toBe(1);
      expect(
        await prisma.outboxEvent.count({
          where: { eventKey: `notification-delivery:${first.id}` },
        }),
      ).toBe(1);
    } finally {
      unregister();
    }
  });

  it('transfers conversation ownership and repairs surviving counters on purge', async () => {
    const owner = await makeUser();
    const survivor = await makeUser();
    const clubOwner = await makeUser();
    [owner.id, survivor.id, clubOwner.id].forEach(id => userIds.add(id));
    const conversation = await prisma.conversation.create({
      data: {
        ownerId: owner.id,
        members: { create: [{ userId: owner.id }, { userId: survivor.id }] },
      },
    });
    const club = await prisma.club.create({
      data: {
        name: `Data club ${suffix()}`,
        slug: `data-club-${suffix()}`,
        ownerId: clubOwner.id,
        memberCount: 2,
        members: {
          create: [
            { userId: clubOwner.id, role: 'ADMIN' },
            { userId: owner.id, role: 'MEMBER' },
          ],
        },
      },
    });
    await prisma.follow.create({
      data: { followerId: owner.id, followingId: survivor.id, status: 'ACCEPTED' },
    });
    await prisma.user.update({ where: { id: owner.id }, data: { followingCount: 99 } });
    await prisma.user.update({ where: { id: survivor.id }, data: { followerCount: 99 } });

    expect(await hardDeleteUserWithRelationalRepair(owner.id)).toBe(true);
    userIds.delete(owner.id);
    expect(await prisma.conversation.findUnique({ where: { id: conversation.id } })).toMatchObject({
      ownerId: survivor.id,
    });
    expect(await prisma.user.findUnique({ where: { id: survivor.id } })).toMatchObject({
      followerCount: 0,
    });
    expect(await prisma.club.findUnique({ where: { id: club.id } })).toMatchObject({
      memberCount: 1,
    });

    await prisma.user.update({ where: { id: survivor.id }, data: { followerCount: 7 } });
    await prisma.club.update({ where: { id: club.id }, data: { memberCount: 7 } });
    await reconcileDenormalizedCounts();
    expect(await prisma.user.findUnique({ where: { id: survivor.id } })).toMatchObject({
      followerCount: 0,
    });
    expect(await prisma.club.findUnique({ where: { id: club.id } })).toMatchObject({
      memberCount: 1,
    });
  });

  it('preserves shared conversations and clubs with deterministic purge successors', async () => {
    const owner = await makeUser();
    const activeMember = await makeUser();
    const activeModerator = await makeUser();
    const softDeletedMember = await makeUser();
    [owner.id, activeMember.id, activeModerator.id, softDeletedMember.id].forEach(id =>
      userIds.add(id),
    );
    await prisma.user.update({
      where: { id: softDeletedMember.id },
      data: { deletedAt: new Date() },
    });

    const activeConversation = await prisma.conversation.create({
      data: {
        ownerId: owner.id,
        members: {
          create: [
            { userId: owner.id },
            { userId: softDeletedMember.id, joinedAt: new Date('2026-01-01T00:00:00Z') },
            { userId: activeMember.id, joinedAt: new Date('2026-02-01T00:00:00Z') },
          ],
        },
      },
    });
    const graceConversation = await prisma.conversation.create({
      data: {
        ownerId: owner.id,
        members: { create: [{ userId: owner.id }, { userId: softDeletedMember.id }] },
      },
    });
    const emptyConversation = await prisma.conversation.create({
      data: { ownerId: owner.id, members: { create: { userId: owner.id } } },
    });

    const activeClub = await prisma.club.create({
      data: {
        name: `Active successor ${suffix()}`,
        slug: `active-successor-${suffix()}`,
        ownerId: owner.id,
        memberCount: 4,
        members: {
          create: [
            { userId: owner.id, role: 'ADMIN' },
            {
              userId: softDeletedMember.id,
              role: 'ADMIN',
              joinedAt: new Date('2026-01-01T00:00:00Z'),
            },
            {
              userId: activeMember.id,
              role: 'MEMBER',
              joinedAt: new Date('2026-02-01T00:00:00Z'),
            },
            {
              userId: activeModerator.id,
              role: 'MODERATOR',
              joinedAt: new Date('2026-03-01T00:00:00Z'),
            },
          ],
        },
      },
    });
    const graceClub = await prisma.club.create({
      data: {
        name: `Grace successor ${suffix()}`,
        slug: `grace-successor-${suffix()}`,
        ownerId: owner.id,
        memberCount: 2,
        members: {
          create: [
            { userId: owner.id, role: 'ADMIN' },
            { userId: softDeletedMember.id, role: 'MEMBER' },
          ],
        },
      },
    });
    const emptyClub = await prisma.club.create({
      data: {
        name: `Empty successor ${suffix()}`,
        slug: `empty-successor-${suffix()}`,
        ownerId: owner.id,
        members: { create: { userId: owner.id, role: 'ADMIN' } },
      },
    });

    expect(await hardDeleteUserWithRelationalRepair(owner.id)).toBe(true);
    userIds.delete(owner.id);

    expect(
      await prisma.conversation.findUnique({ where: { id: activeConversation.id } }),
    ).toMatchObject({ ownerId: activeMember.id });
    expect(
      await prisma.conversation.findUnique({ where: { id: graceConversation.id } }),
    ).toMatchObject({ ownerId: softDeletedMember.id });
    expect(
      await prisma.conversation.findUnique({ where: { id: emptyConversation.id } }),
    ).toBeNull();

    expect(await prisma.club.findUnique({ where: { id: activeClub.id } })).toMatchObject({
      ownerId: activeModerator.id,
      memberCount: 3,
    });
    expect(
      await prisma.clubMember.findUnique({
        where: { clubId_userId: { clubId: activeClub.id, userId: activeModerator.id } },
      }),
    ).toMatchObject({ role: 'ADMIN' });
    expect(await prisma.club.findUnique({ where: { id: graceClub.id } })).toMatchObject({
      ownerId: softDeletedMember.id,
      memberCount: 1,
    });
    expect(
      await prisma.clubMember.findUnique({
        where: { clubId_userId: { clubId: graceClub.id, userId: softDeletedMember.id } },
      }),
    ).toMatchObject({ role: 'ADMIN' });
    expect(await prisma.club.findUnique({ where: { id: emptyClub.id } })).toBeNull();
  });
});
