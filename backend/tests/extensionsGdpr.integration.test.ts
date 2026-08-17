import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/* eslint-disable @typescript-eslint/no-require-imports */
const { createApp } = require('../src/app') as typeof import('../src/app');
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { redis, connectRedis, disconnectRedis } =
  require('../src/config/redis') as typeof import('../src/config/redis');
const { purgeExtensionDataForUser } =
  require('../src/extensions/gdpr') as typeof import('../src/extensions/gdpr');
const { livekitRevocationOutboxData } =
  require('../src/modules/rooms/livekit-revocation.outbox') as typeof import('../src/modules/rooms/livekit-revocation.outbox');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = (): string => Math.random().toString(36).slice(2, 10);

describe('GDPR export and purge for Redis-backed extensions', () => {
  let app: Express;
  const userIds: string[] = [];
  const cleanupKeys = new Set<string>();

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    if (cleanupKeys.size > 0) await redis.del([...cleanupKeys]);
    for (const id of userIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('exports owned extension data, then erases and anonymizes every user reference', async () => {
    const username = `gdpr_ext_${rand()}`;
    const registered = await request(app)
      .post('/api/auth/register')
      .send({
        username,
        email: `${username}@test.local`,
        password: 'test-password-123',
      });
    const userId = registered.body.data.user.id as string;
    const token = registered.body.data.accessToken as string;
    userIds.push(userId);

    const other = await prisma.user.create({
      data: { username: `gdpr_other_${rand()}` },
      select: { id: true },
    });
    userIds.push(other.id);

    const messageId = `msg_${rand()}`;
    const clubId = `club_${rand()}`;
    const phoneHmac = rand().repeat(8).slice(0, 64);
    const keys = {
      audio: `ext:audio:prefs:${userId}`,
      profileLinks: `ext:profile:links:${userId}`,
      history: `ext:nominator:history:${userId}`,
      invited: `ext:nominator:invited:${phoneHmac}`,
      search: `ext:searchhist:${userId}`,
      reactionUser: `ext:chatreact:${messageId}:user`,
      reactionSet: `ext:chatreact:${messageId}:by:🔥`,
      otherMute: `ext:notif:mute:user:${other.id}`,
      otherHistory: `ext:nominator:history:${other.id}`,
      featured: `ext:clubmeta:featured:${clubId}`,
      joinRequest: `ext:clubreq:${clubId}:${userId}`,
      joinIndex: `ext:clubreq:club:${clubId}`,
      fanoutDone: `ext:fanout:v2:notified:room_${rand()}`,
      fanoutClaim: `ext:fanout:v2:claim:room_${rand()}:${userId}`,
      twitter: `ext:twitter:pkce:${rand()}`,
    };
    Object.values(keys).forEach(key => cleanupKeys.add(key));

    const transitionId = randomUUID();
    const revocationEnvelope = await prisma.outboxEvent.create({
      data: livekitRevocationOutboxData({ roomId: `purged-room-${rand()}`, userId }, transitionId),
    });

    await Promise.all([
      redis.set(keys.audio, JSON.stringify({ qualityTier: 'high' })),
      redis.set(
        keys.profileLinks,
        JSON.stringify([{ id: 'link-1', label: 'Blog', url: 'https://example.test' }]),
      ),
      redis.rPush(
        keys.history,
        JSON.stringify({
          id: 'invite-1',
          invitedPhone: '+*******89',
          invitedPhoneHmac: phoneHmac,
          invitedName: 'Contact',
          acceptedUserId: null,
          createdAt: new Date().toISOString(),
        }),
      ),
      redis.set(keys.invited, userId),
      redis.rPush(keys.search, 'audio rooms'),
      redis.hSet(keys.reactionUser, userId, '🔥'),
      redis.sAdd(keys.reactionSet, userId),
      redis.sAdd(keys.otherMute, userId),
      redis.rPush(
        keys.otherHistory,
        JSON.stringify({
          id: 'invite-other',
          invitedPhone: '+*******12',
          invitedPhoneHmac: rand(),
          invitedName: 'Former user',
          acceptedUserId: userId,
          createdAt: new Date().toISOString(),
        }),
      ),
      redis.rPush(keys.featured, userId),
      redis.set(
        keys.joinRequest,
        JSON.stringify({
          clubId,
          userId,
          message: 'Please add me',
          createdAt: new Date().toISOString(),
        }),
      ),
      redis.sAdd(keys.joinIndex, userId),
      redis.sAdd(keys.fanoutDone, userId),
      redis.set(keys.fanoutClaim, 'processing-token'),
      redis.set(keys.twitter, JSON.stringify({ userId, codeVerifier: 'x'.repeat(43) })),
    ]);

    const exported = await request(app)
      .get('/api/users/me/export')
      .set('Authorization', `Bearer ${token}`);
    expect(exported.status).toBe(200);
    const archive = JSON.parse(exported.text) as {
      exportFormat: string;
      extensionData: {
        audioPreferences: { qualityTier: string };
        profileLinks: { label: string }[];
        searchHistory: string[];
        invitations: { history: { invitedPhone: string }[] };
        chatReactions: { messageId: string; emoji: string }[];
      };
    };
    expect(archive.exportFormat).toBe('chathouse-user-export-v4');
    expect(archive.extensionData.audioPreferences.qualityTier).toBe('high');
    expect(archive.extensionData.profileLinks[0]?.label).toBe('Blog');
    expect(archive.extensionData.searchHistory).toContain('audio rooms');
    expect(archive.extensionData.invitations.history[0]?.invitedPhone).toBe('+*******89');
    expect(archive.extensionData.chatReactions).toContainEqual({ messageId, emoji: '🔥' });

    await purgeExtensionDataForUser(userId);

    expect(await redis.get(keys.audio)).toBeNull();
    expect(await redis.get(keys.profileLinks)).toBeNull();
    expect(await redis.get(keys.invited)).toBeNull();
    expect(await redis.hGet(keys.reactionUser, userId)).toBeNull();
    expect(Boolean(await redis.sIsMember(keys.reactionSet, userId))).toBe(false);
    expect(Boolean(await redis.sIsMember(keys.otherMute, userId))).toBe(false);
    expect(await redis.lRange(keys.featured, 0, -1)).not.toContain(userId);
    expect(await redis.get(keys.joinRequest)).toBeNull();
    expect(Boolean(await redis.sIsMember(keys.joinIndex, userId))).toBe(false);
    expect(Boolean(await redis.sIsMember(keys.fanoutDone, userId))).toBe(false);
    expect(await redis.get(keys.fanoutClaim)).toBeNull();
    expect(await redis.get(keys.twitter)).toBeNull();
    expect(
      await prisma.outboxEvent.findUnique({ where: { id: revocationEnvelope.id } }),
    ).toBeNull();

    const anonymized = JSON.parse((await redis.lIndex(keys.otherHistory, 0)) ?? '{}') as {
      acceptedUserId?: string | null;
    };
    expect(anonymized.acceptedUserId).toBeNull();
  });
});
