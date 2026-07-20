import { MediaKind, Prisma } from '@prisma/client';
import type { ClubMemberRole } from '@prisma/client';
import { prisma } from '../../config/database';
import { redis } from '../../config/redis';
import { logger } from '../../config/logger';
import { AppError } from '../../middlewares/error.middleware';
import { notificationsService } from '../notifications/notifications.service';
import { getBlockedIdSet } from '../social/blocks';
import { mediaService } from '../media/media.service';
import { clubInclude, privacyToDb, publicUser, toApi, toSummary } from './clubs.mapper';
import type { ViewerMembership } from './clubs.mapper';
import { clubInviteToken } from './clubs.invite-token';
import type { CreateClubInput, ListClubsInput, UpdateClubInput } from './clubs.schema';

// Public base URL for house invite deep links. Aligns with the linking config
// route `house/:houseId/invite/:inviteToken?` so a shared link is routable.
const INVITE_LINK_BASE = 'https://app.chathouse.com';

const buildInviteUrl = (clubId: string, token: string): string =>
  `${INVITE_LINK_BASE}/house/${clubId}/invite/${token}`;

const inviterStillControlsClub = async (
  clubId: string,
  ownerId: string,
  inviterId: string,
): Promise<boolean> => {
  if (inviterId === ownerId) {
    return (
      (await prisma.user.count({
        where: { id: inviterId, deletedAt: null },
      })) === 1
    );
  }
  return (
    (await prisma.clubMember.count({
      where: {
        clubId,
        userId: inviterId,
        role: { in: ['ADMIN', 'MODERATOR'] },
        user: { deletedAt: null },
      },
    })) === 1
  );
};

const validInviteTokenForClub = async (
  token: string | undefined,
  club: { id: string; ownerId: string },
): Promise<boolean> => {
  if (!token) return false;
  const result = clubInviteToken.verify(token);
  if (!result.ok || result.claims.clubId !== club.id) return false;
  return inviterStillControlsClub(club.id, club.ownerId, result.claims.inviterId);
};

const activeClubForViewerWhere = (clubId: string, viewerId: string): Prisma.ClubWhereInput => ({
  id: clubId,
  owner: {
    deletedAt: null,
    blocksCreated: { none: { blockedId: viewerId } },
    blocksReceived: { none: { blockerId: viewerId } },
  },
});

/** Map the frontend's lowercase role to the Prisma ClubMemberRole enum. */
const roleToDb = (role: 'admin' | 'moderator' | 'member'): ClubMemberRole => {
  if (role === 'admin') return 'ADMIN';
  if (role === 'moderator') return 'MODERATOR';
  return 'MEMBER';
};

/** Slugify a club name: lowercase, replace spaces with hyphens, strip non-alnum. */
const slugify = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 60);

export const clubsService = {
  async list(viewerId: string, input: ListClubsInput) {
    const where: Prisma.ClubWhereInput =
      input.filter === 'mine'
        ? {
            owner: { deletedAt: null },
            members: { some: { userId: viewerId } },
          }
        : {
            // SOCIAL clubs are request-to-join; they must still be discoverable
            // (the FE routes the join through the clubreq request flow). Only
            // PRIVATE clubs and clubs the viewer already belongs to are hidden.
            owner: {
              deletedAt: null,
              blocksCreated: { none: { blockedId: viewerId } },
              blocksReceived: { none: { blockerId: viewerId } },
            },
            privacy: { in: ['OPEN', 'SOCIAL'] },
            members: { none: { userId: viewerId } },
          };

    const clubs = await prisma.club.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      include: clubInclude,
    });
    return clubs.map(toSummary);
  },

  /**
   * The viewer's own membership row, resolved from the authoritative unique
   * index (clubId, userId) — NOT from `club.members`, which `clubInclude.take`
   * truncates. A member past the display window is still a member; deriving
   * membership from the truncated slice would wrongly lock them out of their
   * own PRIVATE roster and hide their admin/moderator CTAs.
   */
  async resolveViewerMembership(viewerId: string, clubId: string): Promise<ViewerMembership> {
    return prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: viewerId } },
      select: {
        role: true,
        joinedAt: true,
        user: { select: publicUser },
      },
    });
  },

  async get(viewerId: string, clubId: string, inviteToken?: string) {
    // Resolve access from a minimal row before loading the bounded roster.
    // This prevents a PRIVATE club from becoming an IDOR merely because an
    // authenticated caller guessed its id.
    const [clubAccess, viewerMembership] = await Promise.all([
      prisma.club.findFirst({
        where: {
          id: clubId,
          owner: {
            deletedAt: null,
            blocksCreated: { none: { blockedId: viewerId } },
            blocksReceived: { none: { blockerId: viewerId } },
          },
        },
        select: { id: true, ownerId: true, privacy: true },
      }),
      this.resolveViewerMembership(viewerId, clubId),
    ]);
    if (!clubAccess) throw new AppError('CLUB_001');

    let viewerInvite: Awaited<ReturnType<typeof this.viewerInvite>> = null;
    if (clubAccess.privacy === 'PRIVATE' && clubAccess.ownerId !== viewerId && !viewerMembership) {
      viewerInvite = await this.viewerInvite(viewerId, clubId, clubAccess.ownerId);
      const tokenAllowed = await validInviteTokenForClub(inviteToken, clubAccess);
      if (!viewerInvite && !tokenAllowed) throw new AppError('CLUB_001');
    }

    const club = await prisma.club.findUnique({
      where: { id: clubId },
      include: clubInclude,
    });
    if (!club) throw new AppError('CLUB_001');
    const api = toApi(club, viewerId, viewerMembership);
    // Surface a pending invitation for the viewer so the detail screen can show
    // an "Accept invitation" CTA (a non-member landing on a PRIVATE house would
    // otherwise hit a dead end). Backed by the existing CLUB_INVITE notification
    // — no new persistence. Skip the lookup entirely when the viewer is already
    // a member (they have nothing to accept).
    if (!api.isJoinedByMe && viewerInvite === null) {
      viewerInvite = await this.viewerInvite(viewerId, clubId, club.ownerId);
    }
    return { ...api, viewerInvite };
  },

  /**
   * Whether the viewer has a pending, real CLUB_INVITE for this club. Mirrors
   * the invite discriminator used by acceptInvitation (a real invite has
   * `inviterId` present and `kind` absent — the clubreq extension reuses the
   * CLUB_INVITE type for its request lifecycle with a `kind` field).
   */
  async viewerInvite(
    viewerId: string,
    clubId: string,
    ownerId?: string,
  ): Promise<{ pending: true; inviterId: string | null } | null> {
    const candidates = await prisma.notification.findMany({
      where: {
        userId: viewerId,
        type: 'CLUB_INVITE',
        data: { path: ['clubId'], equals: clubId },
      },
      select: { data: true },
    });
    const invites = candidates.filter(n => {
      const d = n.data;
      if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
      const payload = d as Record<string, unknown>;
      return payload.kind === undefined && payload.inviterId !== undefined;
    });
    if (invites.length === 0) return null;

    const resolvedOwnerId =
      ownerId ??
      (
        await prisma.club.findUnique({
          where: { id: clubId },
          select: { ownerId: true },
        })
      )?.ownerId;
    if (!resolvedOwnerId) return null;

    for (const invite of invites) {
      const payload = invite.data as Record<string, unknown>;
      const inviterId = typeof payload.inviterId === 'string' ? payload.inviterId : null;
      if (inviterId && (await inviterStillControlsClub(clubId, resolvedOwnerId, inviterId))) {
        return { pending: true, inviterId };
      }
    }
    return null;
  },

  async create(ownerId: string, input: CreateClubInput) {
    // Limit: one club per user unless we add premium later.
    const existingCount = await prisma.club.count({ where: { ownerId } });
    if (existingCount >= 3) throw new AppError('CLUB_006');

    const slug = slugify(input.name);
    // Ensure slug uniqueness by appending a suffix if needed
    let finalSlug = slug;
    const existing = await prisma.club.findUnique({ where: { slug } });
    if (existing) {
      finalSlug = `${slug}-${Date.now().toString(36)}`;
    }
    if (input.iconUrl) {
      await mediaService.assertOwnedMediaUrl(ownerId, input.iconUrl, MediaKind.AVATAR);
    }

    const club = await prisma.$transaction(async tx => {
      const created = await tx.club.create({
        data: {
          name: input.name.trim(),
          slug: finalSlug,
          description: input.description?.trim() || null,
          rules: input.rules?.trim() || null,
          privacy: privacyToDb(input.privacy),
          category: input.category,
          categoryEmoji: input.categoryEmoji,
          iconUrl: input.iconUrl ?? null,
          ownerId,
          memberCount: 1,
          members: {
            create: { userId: ownerId, role: 'ADMIN' },
          },
        },
        include: clubInclude,
      });
      return created;
    });
    // The owner was just created as the sole ADMIN member and is always within
    // the (single-member) slice; derive their membership from it directly.
    const ownerMember = club.members.find(m => m.userId === ownerId) ?? null;
    const viewerMembership: ViewerMembership = ownerMember
      ? { role: ownerMember.role, joinedAt: ownerMember.joinedAt, user: ownerMember.user }
      : null;
    return toApi(club, ownerId, viewerMembership);
  },

  async join(viewerId: string, clubId: string) {
    const club = await prisma.club.findFirst({
      where: activeClubForViewerWhere(clubId, viewerId),
    });
    if (!club) throw new AppError('CLUB_001');
    if (club.privacy === 'PRIVATE') throw new AppError('CLUB_003');
    // CLUB-01: SOCIAL clubs are gated by an approval request that lives in the
    // clubreq extension. The core direct-join path must not fall through and
    // grant immediate membership, or the SOCIAL approval guard is bypassed.
    if (club.privacy === 'SOCIAL') {
      throw new AppError('CLUB_003', 'Social club — request approval to join');
    }

    try {
      await prisma.$transaction(async tx => {
        const existing = await tx.clubMember.findUnique({
          where: { clubId_userId: { clubId, userId: viewerId } },
          select: { id: true },
        });
        if (existing) throw new AppError('CLUB_004');

        const eligible = await tx.club.updateMany({
          where: {
            ...activeClubForViewerWhere(clubId, viewerId),
            privacy: 'OPEN',
          },
          data: { memberCount: { increment: 1 } },
        });
        if (eligible.count !== 1) {
          throw new AppError('CLUB_003', 'Club is no longer open');
        }
        await tx.clubMember.create({
          data: { clubId, userId: viewerId, role: 'MEMBER' },
        });
      });
    } catch (err) {
      // CLUB-04: lost a race with a concurrent join/accept — the unique
      // (clubId,userId) constraint fired. Surface as CLUB_004 instead of a
      // raw 500, mirroring the existing-member guard above.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError('CLUB_004');
      }
      throw err;
    }
    return { joined: true as const };
  },

  async leave(viewerId: string, clubId: string) {
    const club = await prisma.club.findUnique({ where: { id: clubId } });
    if (!club) throw new AppError('CLUB_001');
    if (club.ownerId === viewerId) throw new AppError('CLUB_005');

    await prisma.$transaction(async tx => {
      const removed = await tx.clubMember.deleteMany({
        where: { clubId, userId: viewerId },
      });
      if (removed.count > 0) {
        await tx.$executeRaw`
          UPDATE "Club"
          SET "memberCount" = GREATEST("memberCount" - 1, 1),
              "updatedAt" = NOW()
          WHERE "id" = ${clubId}`;
      }
      return removed;
    });
    return { left: true as const };
  },

  /**
   * Invite users into a club by creating CLUB_INVITE notifications. Only
   * members of the club (any role) may invite; this matches the frontend
   * flow where any joined user can pull friends in.
   * Private clubs require an invite to join, so the recipient's accept
   * path (Module 6 / notifications) will honour the CLUB_INVITE payload.
   */
  async invite(
    inviterId: string,
    clubId: string,
    userIds: readonly string[],
  ): Promise<{ sent: number; token: string; url: string }> {
    const club = await prisma.club.findFirst({
      where: activeClubForViewerWhere(clubId, inviterId),
    });
    if (!club) throw new AppError('CLUB_001');

    const inviterMember = await prisma.clubMember.findFirst({
      where: { clubId, userId: inviterId, user: { deletedAt: null } },
    });
    if (!inviterMember) throw new AppError('CLUB_002');
    // CLUB-03: invites gatekeep entry into PRIVATE clubs (the only way in), so
    // they must be reserved to OWNER/ADMIN/MODERATOR — a plain MEMBER must not
    // be able to pull arbitrary users into a club.
    const inviterIsPrivileged =
      club.ownerId === inviterId ||
      inviterMember.role === 'ADMIN' ||
      inviterMember.role === 'MODERATOR';
    if (!inviterIsPrivileged) throw new AppError('CLUB_002');

    // A signed, stateless invite token for this club, attributed to the
    // inviter. Always minted (even when no direct invites are sent) so the
    // caller gets a shareable link that recipients can accept via the
    // accept-by-token endpoint — the notification path below is the direct,
    // per-user complement to the link.
    const token = clubInviteToken.sign(clubId, inviterId);
    const url = buildInviteUrl(clubId, token);

    // Skip users that are already members — no point inviting them.
    const uniqueCandidates = [...new Set(userIds)].filter(id => id !== inviterId);
    const [existingMembers, activeUsers, inviterBlocked, ownerBlocked] = await Promise.all([
      prisma.clubMember.findMany({
        where: { clubId, userId: { in: uniqueCandidates } },
        select: { userId: true },
      }),
      prisma.user.findMany({
        where: { id: { in: uniqueCandidates }, deletedAt: null },
        select: { id: true },
      }),
      getBlockedIdSet(inviterId),
      club.ownerId === inviterId
        ? Promise.resolve(new Set<string>())
        : getBlockedIdSet(club.ownerId),
    ]);
    const memberSet = new Set(existingMembers.map(m => m.userId));
    const activeSet = new Set(activeUsers.map(user => user.id));
    const targets = uniqueCandidates.filter(
      id =>
        activeSet.has(id) && !memberSet.has(id) && !inviterBlocked.has(id) && !ownerBlocked.has(id),
    );
    if (targets.length === 0) return { sent: 0, token, url };

    // Route through notificationsService.create so each invitee also
    // gets a push dispatch. Kept sequential-ish via Promise.all — the
    // list is capped at 50 by the invite schema so fan-out is bounded.
    await Promise.all(
      targets.map(userId =>
        notificationsService.create({
          userId,
          type: 'CLUB_INVITE',
          title: 'Club invitation',
          body: `You've been invited to join ${club.name}`,
          data: { clubId, inviterId } as Prisma.InputJsonValue,
        }),
      ),
    );

    return { sent: targets.length, token, url };
  },

  async acceptInvitation(viewerId: string, clubId: string, inviteToken?: string) {
    const club = await prisma.club.findFirst({
      where: activeClubForViewerWhere(clubId, viewerId),
    });
    if (!club) throw new AppError('CLUB_001');
    const blocked = await getBlockedIdSet(viewerId);

    const existing = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: viewerId } },
    });
    // Idempotent: accepting again (or after joining another way) is a success,
    // never a duplicate-key 500.
    if (existing) return { joined: true as const, alreadyMember: true as const };

    // SECURITY: entry into a club (esp. PRIVATE, whose only door is an invite)
    // requires proof the viewer was actually invited. Two independent proofs
    // are accepted:
    //   1. A signed invite TOKEN from a shared link (stateless — the club id +
    //      expiry are HMAC-signed, so it can't be forged or replayed after
    //      expiry). Differentiated errors: expired → CLUB_008, invalid → CLUB_009.
    //   2. A real CLUB_INVITE notification addressed to this user for this club.
    // Without either, any authenticated user could POST /accept and join any
    // club, bypassing the join() guard (CLUB_003).
    let authorised = false;
    let consumedNotificationId: string | null = null;

    if (inviteToken) {
      const result = clubInviteToken.verify(inviteToken);
      if (!result.ok) {
        throw new AppError(result.reason === 'expired' ? 'CLUB_008' : 'CLUB_009');
      }
      // A well-signed token for a *different* club must not grant entry here.
      if (result.claims.clubId !== clubId) throw new AppError('CLUB_009');
      // Revocation follows the inviter's current club role. A removed or
      // demoted inviter cannot keep admitting members until token expiry.
      if (
        blocked.has(result.claims.inviterId) ||
        !(await inviterStillControlsClub(clubId, club.ownerId, result.claims.inviterId))
      ) {
        throw new AppError('CLUB_009');
      }
      authorised = true;
    }

    if (!authorised) {
      // CLUB-02: the CLUB_INVITE type is reused by the clubreq extension for the
      // request lifecycle (join_request / join_approved / join_declined). Those
      // carry a `kind` discriminator and must NOT be accepted as an invitation —
      // otherwise a *declined* user could later join a (newly) PRIVATE club.
      // A real invite has `inviterId` present and `kind` absent.
      const candidates = await prisma.notification.findMany({
        where: {
          userId: viewerId,
          type: 'CLUB_INVITE',
          data: { path: ['clubId'], equals: clubId },
        },
        select: { id: true, data: true },
      });
      const invite = candidates.find(n => {
        const d = n.data;
        if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
        const payload = d as Record<string, unknown>;
        return payload.kind === undefined && payload.inviterId !== undefined;
      });
      if (!invite) throw new AppError('CLUB_007');
      const payload = invite.data as Record<string, unknown>;
      const inviterId = typeof payload.inviterId === 'string' ? payload.inviterId : null;
      if (
        !inviterId ||
        blocked.has(inviterId) ||
        !(await inviterStillControlsClub(clubId, club.ownerId, inviterId))
      ) {
        throw new AppError('CLUB_007');
      }
      consumedNotificationId = invite.id;
      authorised = true;
    }

    try {
      await prisma.$transaction([
        prisma.clubMember.create({
          data: { clubId, userId: viewerId, role: 'MEMBER' },
        }),
        prisma.club.update({ where: { id: clubId }, data: { memberCount: { increment: 1 } } }),
        ...(consumedNotificationId
          ? [
              prisma.notification.deleteMany({
                where: { id: consumedNotificationId, userId: viewerId },
              }),
            ]
          : []),
      ]);
    } catch (err) {
      // Lost a race with a concurrent join/accept — the unique (clubId,userId)
      // constraint fired. Treat as idempotent success rather than a raw 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { joined: true as const, alreadyMember: true as const };
      }
      throw err;
    }
    return { joined: true as const, alreadyMember: false as const };
  },

  /**
   * Change a member's role within a club. Only an ADMIN member or the club
   * owner may do this. The owner's role can never be altered (they remain the
   * authoritative ADMIN), and the target must already be a member.
   */
  async setMemberRole(
    viewerId: string,
    clubId: string,
    targetUserId: string,
    role: 'admin' | 'moderator' | 'member',
  ) {
    const club = await prisma.club.findFirst({
      where: activeClubForViewerWhere(clubId, viewerId),
    });
    if (!club) throw new AppError('CLUB_001');

    // Authorisation: viewer must be the owner or an ADMIN member.
    const viewerMembership = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: viewerId } },
    });
    const isAdmin = viewerMembership?.role === 'ADMIN';
    if (!isAdmin && club.ownerId !== viewerId) throw new AppError('CLUB_002');

    // The owner's role is immutable — they always stay ADMIN.
    if (club.ownerId === targetUserId) throw new AppError('CLUB_002');

    const targetMembership = await prisma.clubMember.findFirst({
      where: {
        clubId,
        userId: targetUserId,
        user: {
          deletedAt: null,
          blocksCreated: { none: { blockedId: viewerId } },
          blocksReceived: { none: { blockerId: viewerId } },
        },
      },
    });
    if (!targetMembership) throw new AppError('CLUB_002');

    await prisma.clubMember.update({
      where: { clubId_userId: { clubId, userId: targetUserId } },
      data: { role: roleToDb(role) },
    });

    return this.get(viewerId, clubId);
  },

  /**
   * Remove a member from the club. Only an ADMIN member or the owner can do
   * this; the owner themselves can never be removed (they delete the club
   * instead). Decrements memberCount in the same transaction as the delete.
   */
  async removeMember(viewerId: string, clubId: string, targetUserId: string) {
    const club = await prisma.club.findFirst({
      where: activeClubForViewerWhere(clubId, viewerId),
    });
    if (!club) throw new AppError('CLUB_001');

    const viewerMembership = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: viewerId } },
    });
    const isAdmin = viewerMembership?.role === 'ADMIN';
    if (!isAdmin && club.ownerId !== viewerId) throw new AppError('CLUB_002');

    if (club.ownerId === targetUserId) throw new AppError('CLUB_002');

    const target = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: targetUserId } },
    });
    if (!target) throw new AppError('CLUB_002');

    await prisma.$transaction([
      prisma.clubMember.delete({ where: { clubId_userId: { clubId, userId: targetUserId } } }),
      prisma.club.update({ where: { id: clubId }, data: { memberCount: { decrement: 1 } } }),
    ]);

    return this.get(viewerId, clubId);
  },

  /**
   * Update club details. Only ADMIN members (typically the owner) can edit.
   */
  async update(viewerId: string, clubId: string, input: UpdateClubInput) {
    const club = await prisma.club.findFirst({
      where: activeClubForViewerWhere(clubId, viewerId),
    });
    if (!club) throw new AppError('CLUB_001');
    const membership = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: viewerId } },
    });
    if (!membership || membership.role !== 'ADMIN') throw new AppError('CLUB_002');
    if (input.iconUrl) {
      await mediaService.assertOwnedMediaUrl(viewerId, input.iconUrl, MediaKind.AVATAR);
    }

    const data: Prisma.ClubUpdateInput = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.description !== undefined) data.description = input.description?.trim() || null;
    if (input.rules !== undefined) data.rules = input.rules?.trim() || null;
    if (input.iconUrl !== undefined) data.iconUrl = input.iconUrl;
    if (input.category !== undefined) data.category = input.category;
    if (input.categoryEmoji !== undefined) data.categoryEmoji = input.categoryEmoji;
    if (input.privacy !== undefined) data.privacy = privacyToDb(input.privacy);

    const updated = await prisma.club.update({
      where: { id: clubId },
      data,
      include: clubInclude,
    });
    const viewerMembership = await this.resolveViewerMembership(viewerId, clubId);
    return toApi(updated, viewerId, viewerMembership);
  },

  /**
   * Delete a club. Only the owner can do this. Cascades membership.
   */
  async remove(viewerId: string, clubId: string) {
    const club = await prisma.club.findUnique({ where: { id: clubId } });
    if (!club) throw new AppError('CLUB_001');
    if (club.ownerId !== viewerId) throw new AppError('CLUB_005');

    await prisma.$transaction([
      prisma.clubMember.deleteMany({ where: { clubId } }),
      prisma.club.delete({ where: { id: clubId } }),
    ]);

    // CLUB-07: the clubreq + clubMeta extensions keep state in Redis keyed by
    // clubId. Purge those keys so a deleted club leaves no orphaned join
    // requests / metadata behind. Best-effort: a Redis hiccup must not fail an
    // otherwise-successful deletion.
    try {
      const reqIndexKey = `ext:clubreq:club:${clubId}`;
      const pendingUserIds = await redis.sMembers(reqIndexKey);
      const keysToDelete = [
        reqIndexKey,
        ...pendingUserIds.map(uid => `ext:clubreq:${clubId}:${uid}`),
        `ext:clubmeta:${clubId}`,
        `ext:clubmeta:featured:${clubId}`,
      ];
      await redis.del(keysToDelete);
    } catch (err) {
      logger.warn('clubs.remove: extension key purge failed', { err, clubId });
    }

    return { deleted: true as const };
  },
};
