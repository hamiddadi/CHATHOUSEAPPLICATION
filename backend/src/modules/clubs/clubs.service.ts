import type { Prisma, ClubMemberRole, ClubPrivacy } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';
import { notificationsService } from '../notifications/notifications.service';
import type { CreateClubInput, ListClubsInput, UpdateClubInput } from './clubs.schema';

/** Slugify a club name: lowercase, replace spaces with hyphens, strip non-alnum. */
const slugify = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 60);

const publicUser = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
} as const;

const clubInclude = {
  members: {
    include: { user: { select: publicUser } },
    orderBy: { joinedAt: 'asc' },
  },
  _count: {
    select: {
      members: true,
      rooms: { where: { isLive: true, endedAt: null } },
    },
  },
} satisfies Prisma.ClubInclude;

type ClubWithRelations = Prisma.ClubGetPayload<{ include: typeof clubInclude }>;

// Frontend expects lowercase; Prisma stores uppercase enum values.
const privacyToApi = (p: ClubPrivacy): 'open' | 'private' | 'social' => {
  if (p === 'PRIVATE') return 'private';
  if (p === 'SOCIAL') return 'social';
  return 'open';
};

const roleToApi = (r: ClubMemberRole): 'admin' | 'moderator' | 'member' => {
  if (r === 'ADMIN') return 'admin';
  if (r === 'MODERATOR') return 'moderator';
  return 'member';
};

const privacyToDb = (
  p: 'open' | 'private' | 'social' | 'OPEN' | 'PRIVATE' | 'SOCIAL',
): ClubPrivacy => {
  const upper = p.toUpperCase();
  if (upper === 'PRIVATE') return 'PRIVATE';
  if (upper === 'SOCIAL') return 'SOCIAL';
  return 'OPEN';
};

const userToSummary = (u: {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
}) => ({
  id: u.id,
  username: u.username ?? '',
  displayName: u.displayName ?? u.username ?? '',
  avatarUrl: u.avatarUrl,
  bio: u.bio ?? null,
});

const toApi = (club: ClubWithRelations, viewerId: string) => ({
  id: club.id,
  name: club.name,
  description: club.description ?? '',
  category: club.category,
  categoryEmoji: club.categoryEmoji,
  iconUrl: club.iconUrl,
  privacy: privacyToApi(club.privacy),
  membersCount: club._count.members,
  liveRoomsCount: club._count.rooms,
  isJoinedByMe: club.members.some(m => m.userId === viewerId),
  members: club.members.map(m => ({
    ...userToSummary(m.user),
    role: roleToApi(m.role),
    joinedAt: m.joinedAt.toISOString(),
  })),
  createdAt: club.createdAt.toISOString(),
});

const toSummary = (club: ClubWithRelations) => ({
  id: club.id,
  name: club.name,
  category: club.category,
  categoryEmoji: club.categoryEmoji,
  iconUrl: club.iconUrl,
  membersCount: club._count.members,
  privacy: privacyToApi(club.privacy),
});

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
