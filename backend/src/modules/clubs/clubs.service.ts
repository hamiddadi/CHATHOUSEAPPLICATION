import { Prisma } from '@prisma/client';
import type { ClubMemberRole } from '@prisma/client';
import { prisma } from '../../config/database';
import { redis } from '../../config/redis';
import { logger } from '../../config/logger';
import { AppError } from '../../middlewares/error.middleware';
import { notificationsService } from '../notifications/notifications.service';
import { clubInclude, privacyToDb, toApi, toSummary } from './clubs.mapper';
import type { CreateClubInput, ListClubsInput, UpdateClubInput } from './clubs.schema';

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
        ? { members: { some: { userId: viewerId } } }
        : {
            // SOCIAL clubs are request-to-join; they must still be discoverable
            // (the FE routes the join through the clubreq request flow). Only
            // PRIVATE clubs and clubs the viewer already belongs to are hidden.
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

  async get(viewerId: string, clubId: string) {
    const club = await prisma.club.findUnique({
      where: { id: clubId },
      include: clubInclude,
    });
    if (!club) throw new AppError('CLUB_001');
    return toApi(club, viewerId);
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
    return toApi(club, ownerId);
  },

  async join(viewerId: string, clubId: string) {
    const club = await prisma.club.findUnique({ where: { id: clubId } });
    if (!club) throw new AppError('CLUB_001');
    if (club.privacy === 'PRIVATE') throw new AppError('CLUB_003');
    // CLUB-01: SOCIAL clubs are gated by an approval request that lives in the
    // clubreq extension. The core direct-join path must not fall through and
    // grant immediate membership, or the SOCIAL approval guard is bypassed.
    if (club.privacy === 'SOCIAL') {
      throw new AppError('CLUB_003', 'Social club — request approval to join');
    }

    const existing = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: viewerId } },
    });
    if (existing) throw new AppError('CLUB_004');

    try {
      await prisma.$transaction([
        prisma.clubMember.create({
          data: { clubId, userId: viewerId, role: 'MEMBER' },
        }),
        prisma.club.update({ where: { id: clubId }, data: { memberCount: { increment: 1 } } }),
      ]);
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

    const res = await prisma.clubMember.deleteMany({
      where: { clubId, userId: viewerId },
    });
    if (res.count > 0) {
      await prisma.club.update({ where: { id: clubId }, data: { memberCount: { decrement: 1 } } });
    }
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
  ): Promise<{ sent: number }> {
    const club = await prisma.club.findUnique({ where: { id: clubId } });
    if (!club) throw new AppError('CLUB_001');

    const inviterMember = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: inviterId } },
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

    // Skip users that are already members — no point inviting them.
    const existingMembers = await prisma.clubMember.findMany({
      where: { clubId, userId: { in: [...userIds] } },
      select: { userId: true },
    });
    const memberSet = new Set(existingMembers.map(m => m.userId));
    const targets = userIds.filter(id => id !== inviterId && !memberSet.has(id));
    if (targets.length === 0) return { sent: 0 };

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

    return { sent: targets.length };
  },

  async acceptInvitation(viewerId: string, clubId: string) {
    const club = await prisma.club.findUnique({ where: { id: clubId } });
    if (!club) throw new AppError('CLUB_001');

    const existing = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: viewerId } },
    });
    if (existing) return { joined: true as const };

    // SECURITY: require a real CLUB_INVITE addressed to this user for this
    // club. Without this check any authenticated user could POST
    // /clubs/:id/accept and join ANY club — including PRIVATE ones — bypassing
    // the join() guard (CLUB_003). invite() materialises the invitation as a
    // CLUB_INVITE notification carrying { clubId, inviterId } in its payload.
    //
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
      select: { data: true },
    });
    const invite = candidates.find(n => {
      const d = n.data;
      if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
      const payload = d as Record<string, unknown>;
      return payload.kind === undefined && payload.inviterId !== undefined;
    });
    if (!invite) throw new AppError('CLUB_007');

    await prisma.$transaction([
      prisma.clubMember.create({
        data: { clubId, userId: viewerId, role: 'MEMBER' },
      }),
      prisma.club.update({ where: { id: clubId }, data: { memberCount: { increment: 1 } } }),
    ]);
    return { joined: true as const };
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
    const club = await prisma.club.findUnique({ where: { id: clubId } });
    if (!club) throw new AppError('CLUB_001');

    // Authorisation: viewer must be the owner or an ADMIN member.
    const viewerMembership = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: viewerId } },
    });
    const isAdmin = viewerMembership?.role === 'ADMIN';
    if (!isAdmin && club.ownerId !== viewerId) throw new AppError('CLUB_002');

    // The owner's role is immutable — they always stay ADMIN.
    if (club.ownerId === targetUserId) throw new AppError('CLUB_002');

    const targetMembership = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: targetUserId } },
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
    const club = await prisma.club.findUnique({ where: { id: clubId } });
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
    const club = await prisma.club.findUnique({ where: { id: clubId } });
    if (!club) throw new AppError('CLUB_001');
    const membership = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: viewerId } },
    });
    if (!membership || membership.role !== 'ADMIN') throw new AppError('CLUB_002');

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
    return toApi(updated, viewerId);
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
