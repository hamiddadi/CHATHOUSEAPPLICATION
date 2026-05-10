import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { getBlockedIdSet } from '../social/blocks';
import type { SearchInput } from './search.schema';

const publicUser = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
  isOnline: true,
} as const;

/**
 * Substring search backed by pg_trgm GIN indexes. `contains` with
 * `insensitive` mode translates to ILIKE `%q%` which the trigram index
 * can accelerate. We union fields per entity so a single query matches
 * across username/displayName/bio, name/description, title/topic.
 */

const searchUsers = async (q: string, limit: number, viewerId: string) => {
  const blocked = await getBlockedIdSet(viewerId);
  const users = await prisma.user.findMany({
    where: {
      // A block is symmetric from the search POV: neither side sees the
      // other in results. Always exclude the viewer themselves too.
      id: { notIn: [viewerId, ...blocked] },
      OR: [
        { username: { contains: q, mode: 'insensitive' } },
        { displayName: { contains: q, mode: 'insensitive' } },
        { bio: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: publicUser,
    // Newest first — not the most sophisticated ranking but good enough
    // until we wire a proper relevance score in a later phase.
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return users.map(u => ({
    id: u.id,
    username: u.username ?? '',
    displayName: u.displayName ?? u.username ?? '',
    avatarUrl: u.avatarUrl,
    bio: u.bio,
    isOnline: u.isOnline,
  }));
};

const clubSelect = {
  id: true,
  name: true,
  description: true,
  category: true,
  categoryEmoji: true,
  iconUrl: true,
  privacy: true,
  _count: { select: { members: true } },
} as const satisfies Prisma.ClubSelect;

const searchClubs = async (q: string, limit: number) => {
  const clubs = await prisma.club.findMany({
    where: {
      privacy: 'OPEN',
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: clubSelect,
    orderBy: [{ members: { _count: 'desc' } }, { createdAt: 'desc' }],
    take: limit,
  });
  return clubs.map(c => ({
    id: c.id,
    name: c.name,
    category: c.category,
    categoryEmoji: c.categoryEmoji,
    iconUrl: c.iconUrl,
    membersCount: c._count.members,
    privacy: c.privacy === 'PRIVATE' ? ('private' as const) : ('open' as const),
  }));
};

const roomSelect = {
  id: true,
  title: true,
  description: true,
  topic: true,
  isLive: true,
  scheduledFor: true,
  host: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
  _count: { select: { participants: { where: { leftAt: null } } } },
} as const satisfies Prisma.RoomSelect;

const searchRooms = async (q: string, limit: number) => {
  const rooms = await prisma.room.findMany({
    where: {
      isPrivate: false,
      endedAt: null,
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { topic: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: roomSelect,
    // Live rooms first, then upcoming, then newest.
    orderBy: [{ isLive: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });
  return rooms.map(r => ({
    id: r.id,
    title: r.title,
    description: r.description,
    topic: r.topic,
    isLive: r.isLive,
    scheduledFor: r.scheduledFor?.toISOString() ?? null,
    host: {
      id: r.host.id,
      username: r.host.username ?? '',
      displayName: r.host.displayName ?? r.host.username ?? '',
      avatarUrl: r.host.avatarUrl,
    },
    listenersCount: r._count.participants,
  }));
};

export const searchService = {
  async search(input: SearchInput, viewerId: string) {
    const { q, type, limit } = input;
    if (type === 'users') return { users: await searchUsers(q, limit, viewerId) };
    if (type === 'clubs') return { clubs: await searchClubs(q, limit) };
    if (type === 'rooms') return { rooms: await searchRooms(q, limit) };

    // type === 'all' → run all three in parallel. Split the limit so no
    // single facet blows the payload budget.
    const perFacet = Math.max(5, Math.floor(limit / 3));
    const [users, clubs, rooms] = await Promise.all([
      searchUsers(q, perFacet, viewerId),
      searchClubs(q, perFacet),
      searchRooms(q, perFacet),
    ]);
    return { users, clubs, rooms };
  },
};
