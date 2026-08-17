import { createHmac } from 'node:crypto';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5434/chathouse_test?schema=public';

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { legacyReferenceForCutover, MEDIA_REFERENCE_CUTOVER_KEY, migrateLegacyMediaReferences } =
  require('../src/workers/mediaReferenceCutover.worker') as typeof import('../src/workers/mediaReferenceCutover.worker');
/* eslint-enable @typescript-eslint/no-require-imports */

const secret = 'media-cutover-test-secret-at-least-32-characters';
const config = {
  databaseUrl: process.env.DATABASE_URL!,
  publicOrigin: 'https://api.example.test',
  signingSecret: secret,
};

const signature = (value: string): string =>
  createHmac('sha256', secret).update(value).digest('base64url');
const stableUrl = (mediaId: string): string =>
  `${config.publicOrigin}/media/${mediaId}/${signature(`media:v1:${mediaId}`)}`;
const referenceUrl = (mediaId: string): string =>
  `${config.publicOrigin}/media-ref/${mediaId}/${signature(`media:ref:v1:${mediaId}`)}`;

describe('private-media reference cutover', () => {
  const suffix = Math.random().toString(36).slice(2, 10);
  const userId = `cutover-user-${suffix}`;
  const otherUserId = `cutover-other-${suffix}`;
  const mediaId = `cutover-media-${suffix}`;
  const voiceMediaId = `cutover-voice-${suffix}`;
  const foreignMediaId = `cutover-foreign-${suffix}`;
  const signedReportId = `cutover-report-signed-${suffix}`;
  const canonicalReportId = `cutover-report-canonical-${suffix}`;
  const externalReportId = `cutover-report-external-${suffix}`;
  const clubId = `cutover-club-${suffix}`;

  beforeAll(async () => {
    await prisma.deploymentCutover.deleteMany({
      where: { key: MEDIA_REFERENCE_CUTOVER_KEY },
    });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.user.createMany({
      data: [
        { id: userId, username: `cutover_${suffix}` },
        { id: otherUserId, username: `cutover_other_${suffix}` },
      ],
    });
  });

  afterAll(async () => {
    await prisma.deploymentCutover.deleteMany({
      where: { key: MEDIA_REFERENCE_CUTOVER_KEY },
    });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  it('recognises authentic stable/current capabilities but preserves external URLs', () => {
    const stable = legacyReferenceForCutover(stableUrl(mediaId), config);
    expect(stable).toEqual({
      mediaId,
      replacement: `${config.publicOrigin}/media-ref/${mediaId}/${signature(
        `media:ref:v1:${mediaId}`,
      )}`,
    });

    const expiresAt = '1700000000';
    const current = `${config.publicOrigin}/media/${mediaId}/${expiresAt}/${signature(
      `media:v2:${mediaId}:${expiresAt}`,
    )}`;
    expect(legacyReferenceForCutover(current, config)?.mediaId).toBe(mediaId);
    expect(
      legacyReferenceForCutover('https://cdn.example.test/media/avatar.png', config),
    ).toBeNull();
    expect(() =>
      legacyReferenceForCutover(`${config.publicOrigin}/media/${mediaId}/invalid`, config),
    ).toThrow('signature is invalid');
  });

  it('atomically migrates known fields, preserves external media, and is idempotent', async () => {
    // Jest retries only the failing test body, not beforeAll. Clear the exact
    // fixture rows so an operational failure in the cutover remains retryable.
    await prisma.report.deleteMany({
      where: { id: { in: [signedReportId, canonicalReportId, externalReportId] } },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null, avatarThumb: null },
    });
    await prisma.mediaObject.deleteMany({
      where: { id: { in: [mediaId, voiceMediaId] } },
    });
    await prisma.deploymentCutover.deleteMany({
      where: { key: MEDIA_REFERENCE_CUTOVER_KEY },
    });
    await prisma.mediaObject.create({
      data: {
        id: mediaId,
        ownerId: userId,
        storageKey: `${userId}/avatar/${mediaId}.png`,
        kind: 'AVATAR',
        mimeType: 'image/png',
        sizeBytes: 42,
        uploadCompletedAt: new Date(),
      },
    });
    await prisma.mediaObject.create({
      data: {
        id: voiceMediaId,
        ownerId: userId,
        storageKey: `${userId}/voice/${voiceMediaId}.m4a`,
        kind: 'VOICE',
        mimeType: 'audio/mp4',
        sizeBytes: 84,
        uploadCompletedAt: new Date(),
      },
    });
    await prisma.user.update({
      where: { id: userId },
      data: {
        avatarUrl: stableUrl(mediaId),
        avatarThumb: 'https://cdn.example.test/media/avatar-thumb.png',
      },
    });
    await prisma.club.deleteMany({ where: { id: clubId } });
    await prisma.club.create({
      data: {
        id: clubId,
        name: `Cutover ${suffix}`,
        slug: `cutover-${suffix}`,
        ownerId: userId,
        iconUrl: referenceUrl(mediaId),
        members: { create: { userId, role: 'ADMIN' } },
      },
    });
    await prisma.clubMetadata.create({
      data: { clubId, coverUrl: referenceUrl(mediaId) },
    });
    await prisma.report.createMany({
      data: [
        {
          id: signedReportId,
          reporterId: userId,
          targetKind: 'USER',
          reportedId: otherUserId,
          contentAuthorId: userId,
          contentAudioUrl: stableUrl(voiceMediaId),
          contentKind: 'VOICE',
          contentAudioDurationMs: 1_000,
          reason: 'OTHER',
        },
        {
          id: canonicalReportId,
          reporterId: userId,
          targetKind: 'USER',
          reportedId: otherUserId,
          contentAuthorId: userId,
          contentAudioUrl: referenceUrl(voiceMediaId),
          contentKind: 'VOICE',
          contentAudioDurationMs: 1_000,
          reason: 'OTHER',
        },
        {
          id: externalReportId,
          reporterId: userId,
          targetKind: 'USER',
          reportedId: otherUserId,
          contentAuthorId: userId,
          contentAudioUrl: `https://cdn.example.test/media/${voiceMediaId}/external`,
          contentKind: 'VOICE',
          contentAudioDurationMs: 1_000,
          reason: 'OTHER',
        },
      ],
    });

    const first = await migrateLegacyMediaReferences(prisma, config);
    expect(first.migrated).toBeGreaterThanOrEqual(5);
    expect(first.neutralizedUnavailable).toBe(0);
    expect(first.externalPreserved).toBeGreaterThanOrEqual(1);
    expect(first.scanned).toBeGreaterThanOrEqual(2);
    const stored = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true, avatarThumb: true },
    });
    expect(stored).toEqual({
      avatarUrl: referenceUrl(mediaId),
      avatarThumb: 'https://cdn.example.test/media/avatar-thumb.png',
    });
    await expect(
      prisma.club.findUnique({
        where: { id: clubId },
        select: { iconUrl: true, iconMediaObjectId: true },
      }),
    ).resolves.toEqual({ iconUrl: referenceUrl(mediaId), iconMediaObjectId: mediaId });
    await expect(
      prisma.clubMetadata.findUnique({
        where: { clubId },
        select: { coverUrl: true, coverMediaObjectId: true },
      }),
    ).resolves.toEqual({ coverUrl: referenceUrl(mediaId), coverMediaObjectId: mediaId });
    await expect(
      prisma.report.findMany({
        where: { id: { in: [signedReportId, canonicalReportId, externalReportId] } },
        orderBy: { id: 'asc' },
        select: { id: true, contentAudioUrl: true, contentMediaObjectId: true },
      }),
    ).resolves.toEqual([
      {
        id: canonicalReportId,
        contentAudioUrl: referenceUrl(voiceMediaId),
        contentMediaObjectId: voiceMediaId,
      },
      {
        id: externalReportId,
        contentAudioUrl: `https://cdn.example.test/media/${voiceMediaId}/external`,
        contentMediaObjectId: null,
      },
      {
        id: signedReportId,
        contentAudioUrl: referenceUrl(voiceMediaId),
        contentMediaObjectId: voiceMediaId,
      },
    ]);
    await expect(
      prisma.deploymentCutover.findUnique({ where: { key: MEDIA_REFERENCE_CUTOVER_KEY } }),
    ).resolves.toMatchObject({ key: MEDIA_REFERENCE_CUTOVER_KEY });

    await prisma.deploymentCutover.update({
      where: { key: MEDIA_REFERENCE_CUTOVER_KEY },
      data: { completedAt: new Date(0) },
    });
    const second = await migrateLegacyMediaReferences(prisma, config);
    expect(second.migrated).toBe(0);
    expect(second.externalPreserved).toBeGreaterThanOrEqual(1);
    const marker = await prisma.deploymentCutover.findUnique({
      where: { key: MEDIA_REFERENCE_CUTOVER_KEY },
      select: { completedAt: true, details: true },
    });
    expect(marker).not.toBeNull();
    expect(marker!.completedAt.getTime()).toBeGreaterThan(0);
    expect(marker!.details).toEqual(expect.objectContaining({ verifiedAt: second.verifiedAt }));
  });

  it('preserves authentic historical club assets and neutralizes unavailable club/report media', async () => {
    const historicalMediaId = `cutover-historical-${suffix}`;
    const missingMediaId = `cutover-missing-${suffix}`;
    const historicalClubId = `cutover-historical-club-${suffix}`;
    const staleClubId = `cutover-stale-club-${suffix}`;
    const staleReportId = `cutover-stale-report-${suffix}`;
    await prisma.deploymentCutover.deleteMany({ where: { key: MEDIA_REFERENCE_CUTOVER_KEY } });
    await prisma.mediaObject.create({
      data: {
        id: historicalMediaId,
        ownerId: otherUserId,
        storageKey: `${otherUserId}/avatar/${historicalMediaId}.png`,
        kind: 'AVATAR',
        mimeType: 'image/png',
        sizeBytes: 21,
        uploadCompletedAt: new Date(),
      },
    });
    try {
      await prisma.club.create({
        data: {
          id: historicalClubId,
          name: `Historical ${suffix}`,
          slug: `historical-${suffix}`,
          ownerId: userId,
          iconUrl: referenceUrl(historicalMediaId),
          members: { create: { userId, role: 'ADMIN' } },
        },
      });
      await prisma.club.create({
        data: {
          id: staleClubId,
          name: `Stale ${suffix}`,
          slug: `stale-${suffix}`,
          ownerId: userId,
          iconUrl: referenceUrl(missingMediaId),
          members: { create: { userId, role: 'ADMIN' } },
        },
      });
      await prisma.clubMetadata.createMany({
        data: [
          { clubId: historicalClubId, coverUrl: referenceUrl(historicalMediaId) },
          { clubId: staleClubId, coverUrl: referenceUrl(missingMediaId) },
        ],
      });
      await prisma.report.create({
        data: {
          id: staleReportId,
          reporterId: userId,
          targetKind: 'USER',
          reportedId: otherUserId,
          contentAudioUrl: referenceUrl(missingMediaId),
          contentKind: 'VOICE',
          reason: 'OTHER',
        },
      });

      const result = await migrateLegacyMediaReferences(prisma, config);
      expect(result.migrated).toBeGreaterThanOrEqual(2);
      expect(result.neutralizedUnavailable).toBeGreaterThanOrEqual(3);
      await expect(
        prisma.club.findUnique({
          where: { id: historicalClubId },
          select: { iconUrl: true, iconMediaObjectId: true },
        }),
      ).resolves.toEqual({
        iconUrl: referenceUrl(historicalMediaId),
        iconMediaObjectId: historicalMediaId,
      });
      await expect(
        prisma.clubMetadata.findUnique({
          where: { clubId: historicalClubId },
          select: { coverUrl: true, coverMediaObjectId: true },
        }),
      ).resolves.toEqual({
        coverUrl: referenceUrl(historicalMediaId),
        coverMediaObjectId: historicalMediaId,
      });
      await expect(
        prisma.club.findUnique({
          where: { id: staleClubId },
          select: { iconUrl: true, iconMediaObjectId: true },
        }),
      ).resolves.toEqual({ iconUrl: null, iconMediaObjectId: null });
      await expect(
        prisma.clubMetadata.findUnique({
          where: { clubId: staleClubId },
          select: { coverUrl: true, coverMediaObjectId: true },
        }),
      ).resolves.toEqual({ coverUrl: null, coverMediaObjectId: null });
      await expect(
        prisma.report.findUnique({
          where: { id: staleReportId },
          select: { contentAudioUrl: true, contentMediaObjectId: true },
        }),
      ).resolves.toEqual({ contentAudioUrl: null, contentMediaObjectId: null });
    } finally {
      await prisma.report.deleteMany({ where: { id: staleReportId } });
      await prisma.club.deleteMany({ where: { id: { in: [historicalClubId, staleClubId] } } });
      await prisma.mediaObject.deleteMany({ where: { id: historicalMediaId } });
      await prisma.deploymentCutover.deleteMany({ where: { key: MEDIA_REFERENCE_CUTOVER_KEY } });
    }
  });

  it('rolls back every update and the marker when media ownership is invalid', async () => {
    await prisma.deploymentCutover.deleteMany({
      where: { key: MEDIA_REFERENCE_CUTOVER_KEY },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null },
    });
    await prisma.mediaObject.deleteMany({ where: { id: foreignMediaId } });
    await prisma.mediaObject.create({
      data: {
        id: foreignMediaId,
        ownerId: otherUserId,
        storageKey: `${otherUserId}/avatar/${foreignMediaId}.png`,
        kind: 'AVATAR',
        mimeType: 'image/png',
        sizeBytes: 42,
        uploadCompletedAt: new Date(),
      },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: stableUrl(foreignMediaId) },
    });

    await expect(migrateLegacyMediaReferences(prisma, config)).rejects.toThrow(
      'linked media object owner is not authorized',
    );
    await expect(
      prisma.user.findUnique({ where: { id: userId }, select: { avatarUrl: true } }),
    ).resolves.toEqual({ avatarUrl: stableUrl(foreignMediaId) });
    await expect(
      prisma.deploymentCutover.findUnique({ where: { key: MEDIA_REFERENCE_CUTOVER_KEY } }),
    ).resolves.toBeNull();
  });
});
