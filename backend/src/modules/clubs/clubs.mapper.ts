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
    // Bound the roster so a very large club can't return an unbounded member
    // payload; the authoritative total is always `_count.members`.
    take: 100,
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

// The viewer's own membership row, resolved from a source independent of the
// (truncated) `club.members` slice — see `toApi`. Carries the viewer's public
// user fields so a merged-in row (viewer beyond the display window) is complete.
export type ViewerMembership = {
  role: ClubMemberRole;
  joinedAt: Date;
  user: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    bio: string | null;
  };
} | null;

const memberToApi = (m: ClubWithRelations['members'][number]) => ({
  ...userToSummary(m.user),
  role: roleToApi(m.role),
  joinedAt: m.joinedAt.toISOString(),
});

/**
 * @param viewerMembership The viewer's own ClubMember row (or null if not a
 *   member), resolved authoritatively via a unique lookup on (clubId, userId).
 *   This MUST come from a source independent of `club.members`, which is
 *   truncated by `clubInclude.take`: a member beyond the truncation window is
 *   still a member, and deriving `isJoinedByMe` from the slice would wrongly
 *   lock them out of their own PRIVATE roster.
 */
export const toApi = (
  club: ClubWithRelations,
  viewerId: string,
  viewerMembership: ViewerMembership,
) => {
  const isJoinedByMe = viewerMembership !== null;
  // Privacy gate: the member roster of a PRIVATE house is only served to its
  // members (and the owner). Non-members still get `membersCount` for the
  // header, but the list itself is withheld — a retro-compatible empty array,
  // not a shape change. OPEN/SOCIAL houses stay fully public.
  const canSeeMembers = club.privacy !== 'PRIVATE' || isJoinedByMe || club.ownerId === viewerId;

  let members: ReturnType<typeof memberToApi>[] = [];
  if (canSeeMembers) {
    members = club.members.map(memberToApi);
    // Guarantee the viewer's own membership row is present even when they fall
    // beyond `clubInclude.take` (the display window). The FE derives the
    // viewer's admin/moderator CTAs by scanning `members` for their own entry,
    // so a member past the 100th oldest must still find themselves here.
    if (isJoinedByMe && !members.some(m => m.id === viewerId)) {
      members.push({
        ...userToSummary(viewerMembership.user),
        role: roleToApi(viewerMembership.role),
        joinedAt: viewerMembership.joinedAt.toISOString(),
      });
    }
  }

  return {
    id: club.id,
    name: club.name,
    description: club.description ?? '',
    rules: club.rules ?? null,
    category: club.category,
    categoryEmoji: club.categoryEmoji,
    iconUrl: club.iconUrl,
    privacy: privacyToApi(club.privacy),
    ownerId: club.ownerId,
    membersCount: club._count.members,
    liveRoomsCount: club._count.rooms,
    isJoinedByMe,
    members,
    createdAt: club.createdAt.toISOString(),
  };
};

export const toSummary = (club: ClubWithRelations) => ({
  id: club.id,
  name: club.name,
  category: club.category,
  categoryEmoji: club.categoryEmoji,
  iconUrl: club.iconUrl,
  membersCount: club._count.members,
  privacy: privacyToApi(club.privacy),
});
