import { MediaKind } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma, runWriteWithRetry } from '../../../config/database';
import { redis } from '../../../config/redis';
import {
  isCanonicalPrivateMediaPath,
  mediaIdFromCanonicalPrivateUrl,
  mediaReferenceFor,
} from '../../../modules/media/media-url';
import { mediaService } from '../../../modules/media/media.service';
import { ExtAppError, extError } from '../../utils/ExtAppError';
import { ensureClubExtensionImported } from '../../utils/legacyExtensionImport';

/** PostgreSQL-backed cover photo and featured-member list for a club. */
const FEATURED_CAP = 6;
const IMPORT_NAMESPACE = 'club-metadata-v1';
const metaKey = (clubId: string) => `ext:clubmeta:${clubId}`;
const featuredKey = (clubId: string) => `ext:clubmeta:featured:${clubId}`;

type ClubAuthorizationClient = Pick<Prisma.TransactionClient, 'club' | 'clubMember'>;

const requireClubAdmin = async (
  db: ClubAuthorizationClient,
  clubId: string,
  userId: string,
): Promise<void> => {
  const club = await db.club.findFirst({
    where: {
      id: clubId,
      owner: {
        deletedAt: null,
        blocksCreated: { none: { blockedId: userId } },
        blocksReceived: { none: { blockerId: userId } },
      },
    },
    select: { ownerId: true },
  });
  if (!club) throw extError('CLUB_REQ_NOT_FOUND', 'Club not found');
  if (club.ownerId === userId) return;
  const membership = await db.clubMember.findFirst({
    where: { clubId, userId, user: { deletedAt: null } },
    select: { role: true },
  });
  if (membership?.role !== 'ADMIN' && membership?.role !== 'MODERATOR') {
    throw new ExtAppError('AUTH_008', 'Not allowed', 403);
  }
};

export interface ClubMeta {
  coverUrl: string | null;
  featuredMembers: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  }[];
}

const requireClubReadAccess = async (clubId: string, callerId: string): Promise<void> => {
  const club = await prisma.club.findFirst({
    where: {
      id: clubId,
      owner: {
        deletedAt: null,
        blocksCreated: { none: { blockedId: callerId } },
        blocksReceived: { none: { blockerId: callerId } },
      },
    },
    select: { ownerId: true, privacy: true },
  });
  if (!club) throw extError('CLUB_REQ_NOT_FOUND', 'Club not found');
  if (club.privacy !== 'PRIVATE' || club.ownerId === callerId) return;
  const member = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId, userId: callerId } },
    select: { id: true },
  });
  if (!member) throw extError('CLUB_REQ_NOT_FOUND', 'Club not found');
};

interface LegacyClubMeta {
  coverUrl: string | null;
  featuredIds: string[];
}

const ensureImported = async (clubId: string): Promise<void> => {
  await ensureClubExtensionImported(
    IMPORT_NAMESPACE,
    clubId,
    async () => {
      const [coverUrl, featuredIds] = await Promise.all([
        redis.hGet(metaKey(clubId), 'coverUrl'),
        redis.lRange(featuredKey(clubId), 0, FEATURED_CAP - 1),
      ]);
      return { coverUrl, featuredIds: [...new Set(featuredIds)].slice(0, FEATURED_CAP) };
    },
    async (tx, legacy: LegacyClubMeta) => {
      if (legacy.coverUrl) {
        const parsedMediaId = mediaIdFromCanonicalPrivateUrl(legacy.coverUrl, {
          allowExpired: true,
        });
        if (parsedMediaId) {
          await tx.$queryRaw`
            SELECT "id" FROM "MediaObject"
            WHERE "id" = ${parsedMediaId}
            FOR NO KEY UPDATE`;
        }
        const linkedMedia = parsedMediaId
          ? await tx.mediaObject.findFirst({
              where: {
                id: parsedMediaId,
                kind: MediaKind.AVATAR,
                uploadCompletedAt: { not: null },
                deletionClaimedAt: null,
              },
              select: { id: true, ownerId: true },
            })
          : null;
        const authorized = linkedMedia
          ? await tx.club.count({
              where: {
                id: clubId,
                OR: [
                  { ownerId: linkedMedia.ownerId },
                  {
                    members: {
                      some: {
                        userId: linkedMedia.ownerId,
                        role: { in: ['ADMIN', 'MODERATOR'] },
                      },
                    },
                  },
                ],
              },
            })
          : 0;
        const importableCover =
          parsedMediaId === null && !isCanonicalPrivateMediaPath(legacy.coverUrl)
            ? { coverUrl: legacy.coverUrl.slice(0, 500), coverMediaObjectId: undefined }
            : linkedMedia && authorized === 1
              ? {
                  coverUrl: mediaReferenceFor(linkedMedia.id, new URL(legacy.coverUrl).origin),
                  coverMediaObjectId: linkedMedia.id,
                }
              : null;
        // A signed internal URL with no available/authorized media is stale,
        // not an external cover. Neutralize it instead of persisting a broken
        // URL that could be resurrected after its uploader is purged.
        if (importableCover) {
          await tx.clubMetadata.createMany({
            data: [{ clubId, ...importableCover }],
            skipDuplicates: true,
          });
        }
      }
      if (legacy.featuredIds.length === 0) return;
      const valid = await tx.clubMember.findMany({
        where: {
          clubId,
          userId: { in: legacy.featuredIds },
          user: { deletedAt: null },
        },
        select: { userId: true },
      });
      const validIds = new Set(valid.map(row => row.userId));
      const base = Date.now();
      await tx.clubFeaturedMember.createMany({
        data: legacy.featuredIds
          .filter(userId => validIds.has(userId))
          .map((userId, index) => ({ clubId, userId, featuredAt: new Date(base - index) })),
        skipDuplicates: true,
      });
    },
  );
};

const get = async (clubId: string, viewerId?: string): Promise<ClubMeta> => {
  await ensureImported(clubId);
  const [metadata, featured] = await Promise.all([
    prisma.clubMetadata.findUnique({ where: { clubId }, select: { coverUrl: true } }),
    prisma.clubFeaturedMember.findMany({
      where: {
        clubId,
        user: {
          deletedAt: null,
          ...(viewerId
            ? {
                blocksCreated: { none: { blockedId: viewerId } },
                blocksReceived: { none: { blockerId: viewerId } },
              }
            : {}),
        },
      },
      select: {
        user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      },
      orderBy: [{ featuredAt: 'desc' }, { userId: 'asc' }],
      take: FEATURED_CAP,
    }),
  ]);
  return { coverUrl: metadata?.coverUrl ?? null, featuredMembers: featured.map(row => row.user) };
};

export const clubMetaService = {
  async getForCaller(callerId: string, clubId: string): Promise<ClubMeta> {
    await requireClubReadAccess(clubId, callerId);
    return get(clubId, callerId);
  },

  get,

  async setCover(clubId: string, callerId: string, url: string): Promise<ClubMeta> {
    await requireClubAdmin(prisma, clubId, callerId);
    await ensureImported(clubId);
    await runWriteWithRetry(() =>
      prisma.$transaction(
        async tx => {
          // Account purge takes this same user lock first. A cover write that
          // started with stale authorization therefore either commits before
          // purge or observes the deleted caller and cannot recreate a link.
          const caller = await tx.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "User"
            WHERE "id" = ${callerId} AND "deletedAt" IS NULL
            FOR UPDATE`;
          if (caller.length === 0) throw new ExtAppError('AUTH_008', 'Not allowed', 403);

          await tx.$queryRaw`SELECT "id" FROM "Club" WHERE "id" = ${clubId} FOR UPDATE`;
          await requireClubAdmin(tx, clubId, callerId);
          const mediaId = await mediaService.assertOwnedMediaUrlWithinTransaction(
            tx,
            callerId,
            url,
            MediaKind.AVATAR,
          );
          const canonicalUrl = mediaReferenceFor(mediaId, new URL(url).origin);
          await tx.clubMetadata.upsert({
            where: { clubId },
            create: { clubId, coverUrl: canonicalUrl, coverMediaObjectId: mediaId },
            update: { coverUrl: canonicalUrl, coverMediaObjectId: mediaId },
          });
        },
        { maxWait: 10_000, timeout: 15_000 },
      ),
    );
    return get(clubId, callerId);
  },

  async addFeatured(clubId: string, callerId: string, userId: string): Promise<ClubMeta> {
    await requireClubAdmin(prisma, clubId, callerId);
    await ensureImported(clubId);
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Club" WHERE "id" = ${clubId} FOR UPDATE`;
      const member = await tx.clubMember.findFirst({
        where: {
          clubId,
          userId,
          user: {
            deletedAt: null,
            blocksCreated: { none: { blockedId: callerId } },
            blocksReceived: { none: { blockerId: callerId } },
          },
        },
        select: { id: true },
      });
      if (!member) throw extError('PAY_INVALID', 'User is not a member');

      await tx.clubFeaturedMember.upsert({
        where: { clubId_userId: { clubId, userId } },
        create: { clubId, userId },
        update: { featuredAt: new Date() },
      });
      const overflow = await tx.clubFeaturedMember.findMany({
        where: { clubId },
        orderBy: [{ featuredAt: 'desc' }, { userId: 'asc' }],
        skip: FEATURED_CAP,
        select: { userId: true },
      });
      if (overflow.length > 0) {
        await tx.clubFeaturedMember.deleteMany({
          where: { clubId, userId: { in: overflow.map(row => row.userId) } },
        });
      }
    });
    return get(clubId, callerId);
  },

  async removeFeatured(clubId: string, callerId: string, userId: string): Promise<ClubMeta> {
    await requireClubAdmin(prisma, clubId, callerId);
    await ensureImported(clubId);
    await prisma.clubFeaturedMember.deleteMany({ where: { clubId, userId } });
    return get(clubId, callerId);
  },
};
