import { randomUUID } from 'node:crypto';
import { prisma } from '../src/config/database';
import { connectRedis, disconnectRedis, redis } from '../src/config/redis';
import {
  CLUB_EXTENSION_CLEANUP_TOPIC,
  clubDeletionTombstoneKey,
  clubExtensionCleanupOutboxData,
} from '../src/extensions/club-extension-cleanup.outbox';
import { clubReqService } from '../src/extensions/modules/clubreq/clubreq.service';
import { processOutboxBatch } from '../src/workers/outbox.worker';

const suffix = (): string => randomUUID().replace(/-/g, '').slice(0, 12);

describe('club extension post-commit cleanup', () => {
  const userIds = new Set<string>();
  const eventKeys = new Set<string>();
  const redisKeys = new Set<string>();

  beforeAll(async () => connectRedis());

  afterEach(async () => {
    if (userIds.size > 0) {
      await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
      userIds.clear();
    }
    if (eventKeys.size > 0) {
      await prisma.outboxEvent.deleteMany({ where: { eventKey: { in: [...eventKeys] } } });
      eventKeys.clear();
    }
    if (redisKeys.size > 0) {
      await redis.del([...redisKeys]);
      redisKeys.clear();
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('tombstones a deleted club before cleanup and refuses request recreation', async () => {
    const owner = await prisma.user.create({
      data: { username: `cleanup_owner_${suffix()}` },
      select: { id: true },
    });
    const requester = await prisma.user.create({
      data: { username: `cleanup_requester_${suffix()}` },
      select: { id: true },
    });
    userIds.add(owner.id);
    userIds.add(requester.id);
    const club = await prisma.club.create({
      data: {
        name: `Cleanup ${suffix()}`,
        slug: `cleanup-${suffix()}`,
        privacy: 'SOCIAL',
        ownerId: owner.id,
        members: { create: { userId: owner.id, role: 'ADMIN' } },
      },
    });
    const tombstone = clubDeletionTombstoneKey(club.id);
    const index = `ext:clubreq:club:${club.id}`;
    const request = `ext:clubreq:${club.id}:${requester.id}`;
    const metadata = `ext:clubmeta:${club.id}`;
    const featured = `ext:clubmeta:featured:${club.id}`;
    [tombstone, index, request, metadata, featured].forEach(key => redisKeys.add(key));
    await redis.sAdd(index, requester.id);
    await redis.setEx(request, 3600, JSON.stringify({ clubId: club.id, userId: requester.id }));
    await redis.hSet(metadata, 'coverUrl', 'https://cdn.example.test/cover.png');
    await redis.rPush(featured, owner.id);

    const envelope = clubExtensionCleanupOutboxData(club.id, 'all');
    const eventKey = String(envelope.eventKey);
    eventKeys.add(eventKey);
    await prisma.outboxEvent.create({ data: envelope });
    expect(
      await processOutboxBatch({ topic: CLUB_EXTENSION_CLEANUP_TOPIC, aggregateId: club.id }),
    ).toBe(1);

    await expect(redis.get(tombstone)).resolves.toBe('1');
    await expect(redis.exists(index)).resolves.toBe(0);
    await expect(redis.exists(request)).resolves.toBe(0);
    await expect(redis.exists(metadata)).resolves.toBe(0);
    await expect(redis.exists(featured)).resolves.toBe(0);

    await expect(
      clubReqService.request(requester.id, club.id, 'late request'),
    ).rejects.toMatchObject({ code: 'CLUB_001' });
    await expect(redis.exists(index)).resolves.toBe(0);
    await expect(redis.exists(request)).resolves.toBe(0);
  });
});
