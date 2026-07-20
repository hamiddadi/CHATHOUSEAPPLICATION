import { MediaKind } from '@prisma/client';
import { redis } from '../../../config/redis';
import { prisma } from '../../../config/database';
import { mediaService } from '../../../modules/media/media.service';
import { ExtAppError, extError } from '../../utils/ExtAppError';

/**
 * Club extended metadata (Module 10.7 / CLUB-004) — cover photo +
 * featured-members list, both kept in Redis to avoid a schema migration
 * on the existing `Club` model.
 *
 * Storage :
 *   ext:clubmeta:<clubId>            HASH  coverUrl
 *   ext:clubmeta:featured:<clubId>   LIST  featured member userIds (≤ 6)
 *
 * Authorization : only Club ADMIN or MODERATOR may write. Reads are open
 * to anyone authenticated.
 */

const FEATURED_CAP = 6;
const TTL_S = 90 * 24 * 3600;
const metaKey = (clubId: string) => `ext:clubmeta:${clubId}`;
const featuredKey = (clubId: string) => `ext:clubmeta:featured:${clubId}`;

const UPSERT_FEATURED_SCRIPT = `
redis.call('LREM', KEYS[1], 0, ARGV[1])
redis.call('LPUSH', KEYS[1], ARGV[1])
redis.call('LTRIM', KEYS[1], 0, tonumber(ARGV[2]) - 1)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1
`;

const requireClubAdmin = async (clubId: string, userId: string): Promise<void> => {
  const club = await prisma.club.findFirst({
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
  const m = await prisma.clubMember.findFirst({
    where: { clubId, userId, user: { deletedAt: null } },
    select: { role: true },
  });
  if (m?.role !== 'ADMIN' && m?.role !== 'MODERATOR') {
    // CLUB-05: an authorization failure is a 403, not a 400 PAY_INVALID
    // (which mislabels an RBAC refusal as a bad payment request). Reuse the
    // core AUTH_008 "insufficient privileges" code at its canonical 403.
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

/**
 * Authorization gate for *reads* of a PRIVATE club's metadata. PRIVATE clubs
 * only expose their cover + featured members (PII: username/displayName/
 * avatarUrl) to the owner or a confirmed member. OPEN/SOCIAL clubs stay
 * discoverable (read-open) per the module's design. Fixes a BOLA/IDOR where
 * any authenticated user could enumerate private-club featured members.
 */
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
  if (club.privacy !== 'PRIVATE') return;
  if (club.ownerId === callerId) return;
  const member = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId, userId: callerId } },
    select: { id: true },
  });
  // Surface as 404 to avoid confirming the private club's existence.
  if (!member) throw extError('CLUB_REQ_NOT_FOUND', 'Club not found');
};

export const clubMetaService = {
  /**
   * Authorized read for the public GET route — enforces PRIVATE-club access
   * control before delegating to the internal {@link clubMetaService.get}.
   */
  async getForCaller(callerId: string, clubId: string): Promise<ClubMeta> {
    await requireClubReadAccess(clubId, callerId);
    return this.get(clubId, callerId);
  },

  async get(clubId: string, viewerId?: string): Promise<ClubMeta> {
    const [coverHash, featuredIds] = await Promise.all([
      redis.hGet(metaKey(clubId), 'coverUrl'),
      redis.lRange(featuredKey(clubId), 0, FEATURED_CAP - 1),
    ]);
    let featuredMembers: ClubMeta['featuredMembers'] = [];
    if (featuredIds.length > 0) {
      const users = await prisma.user.findMany({
        where: {
          id: { in: featuredIds },
          deletedAt: null,
          ...(viewerId
            ? {
                blocksCreated: { none: { blockedId: viewerId } },
                blocksReceived: { none: { blockerId: viewerId } },
              }
            : {}),
        },
        select: { id: true, username: true, displayName: true, avatarUrl: true },
      });
      const map = new Map(users.map(u => [u.id, u]));
      featuredMembers = featuredIds
        .map(id => map.get(id))
        .filter((u): u is NonNullable<typeof u> => Boolean(u));
    }
    return { coverUrl: coverHash ?? null, featuredMembers };
  },

  async setCover(clubId: string, callerId: string, url: string): Promise<ClubMeta> {
    await requireClubAdmin(clubId, callerId);
    await mediaService.assertOwnedMediaUrl(callerId, url, MediaKind.AVATAR);
    await Promise.all([
      redis.hSet(metaKey(clubId), 'coverUrl', url),
      redis.expire(metaKey(clubId), TTL_S),
    ]);
    return this.get(clubId, callerId);
  },

  async addFeatured(clubId: string, callerId: string, userId: string): Promise<ClubMeta> {
    await requireClubAdmin(clubId, callerId);
    const member = await prisma.clubMember.findFirst({
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

    await redis.eval(UPSERT_FEATURED_SCRIPT, {
      keys: [featuredKey(clubId)],
      arguments: [userId, String(FEATURED_CAP), String(TTL_S)],
    });
    return this.get(clubId, callerId);
  },

  async removeFeatured(clubId: string, callerId: string, userId: string): Promise<ClubMeta> {
    await requireClubAdmin(clubId, callerId);
    await redis.lRem(featuredKey(clubId), 0, userId);
    return this.get(clubId, callerId);
  },
};
