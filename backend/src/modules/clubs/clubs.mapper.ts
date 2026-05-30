import type { Prisma, ClubMemberRole, ClubPrivacy } from '@prisma/client';

export const publicUser = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
} as const;

export const clubInclude = {
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

export type ClubWithRelations = Prisma.ClubGetPayload<{ include: typeof clubInclude }>;

// Frontend expects lowercase; Prisma stores uppercase enum values.
export const privacyToApi = (p: ClubPrivacy): 'open' | 'private' | 'social' => {
  if (p === 'PRIVATE') return 'private';
  if (p === 'SOCIAL') return 'social';
  return 'open';
};

export const roleToApi = (r: ClubMemberRole): 'admin' | 'moderator' | 'member' => {
  if (r === 'ADMIN') return 'admin';
  if (r === 'MODERATOR') return 'moderator';
  return 'member';
};

export const privacyToDb = (
  p: 'open' | 'private' | 'social' | 'OPEN' | 'PRIVATE' | 'SOCIAL',
): ClubPrivacy => {
  const upper = p.toUpperCase();
  if (upper === 'PRIVATE') return 'PRIVATE';
  if (upper === 'SOCIAL') return 'SOCIAL';
  return 'OPEN';
};

export const userToSummary = (u: {
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

export const toApi = (club: ClubWithRelations, viewerId: string) => ({
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

export const toSummary = (club: ClubWithRelations) => ({
  id: club.id,
  name: club.name,
  category: club.category,
  categoryEmoji: club.categoryEmoji,
  iconUrl: club.iconUrl,
  membersCount: club._count.members,
  privacy: privacyToApi(club.privacy),
});
