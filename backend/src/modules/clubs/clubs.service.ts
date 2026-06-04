import type { ClubMemberRole, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
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
            privacy: 'OPEN',
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

    const existing = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: viewerId } },
    });
    if (existing) throw new AppError('CLUB_004');

    await prisma.$transaction([
      prisma.clubMember.create({
        data: { clubId, userId: viewerId, role: 'MEMBER' },
      }),
      prisma.club.update({ where: { id: clubId }, data: { memberCount: { increment: 1 } } }),
    ]);
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
    // CLUB_INVITE notification carrying { clubId } in its data payload.
    const invite = await prisma.notification.findFirst({
      where: {
        userId: viewerId,
        type: 'CLUB_INVITE',
        data: { path: ['clubId'], equals: clubId },
      },
      select: { id: true },
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
    return { deleted: true as const };
  },
};
