import { prisma } from '../../config/database';
import { getBlockedIdSet } from '../social/blocks';

/**
 * "Explore" aggregates popular content for the home discovery feed. Each
 * facet is capped small (20 rows) so the whole response stays under a few
 * kB. Signals are simple for now — live > scheduled for rooms, member
 * count for clubs, recent activity for users. Ranking can evolve without
 * changing the endpoint shape.
 */

const EXPLORE_ROOMS = 20;
const EXPLORE_CLUBS = 20;
const EXPLORE_USERS = 20;
const ACTIVE_USER_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

const trendingRooms = async () => {
  const rooms = await prisma.room.findMany({
    where: { isLive: true, isPrivate: false, endedAt: null },
    include: {
      host: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      _count: { select: { participants: { where: { leftAt: null } } } },
    },
    // Most-populated live rooms first; break ties with "newest started".
    orderBy: [{ participants: { _count: 'desc' } }, { createdAt: 'desc' }],
    take: EXPLORE_ROOMS,
  });
  return rooms.map(r => ({
    id: r.id,
    title: r.title,
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

const trendingClubs = async () => {
  const clubs = await prisma.club.findMany({
    where: { privacy: 'OPEN' },
    include: {
      _count: {
        select: {
          members: true,
          rooms: { where: { isLive: true, endedAt: null } },
        },
      },
    },
    orderBy: [{ members: { _count: 'desc' } }, { createdAt: 'desc' }],
    take: EXPLORE_CLUBS,
  });
  return clubs.map(c => ({
    id: c.id,
    name: c.name,
    category: c.category,
    categoryEmoji: c.categoryEmoji,
    iconUrl: c.iconUrl,
    membersCount: c._count.members,
    liveRoomsCount: c._count.rooms,
    privacy: 'open' as const,
  }));
};

const featuredUsers = async (viewerId: string) => {
  const since = new Date(Date.now() - ACTIVE_USER_WINDOW_MS);
  const blocked = await getBlockedIdSet(viewerId);
  // "Recently active" — seen in the last 14 days or online right now,
  // excluding the viewer themselves and anyone they've blocked (or who
  // has blocked them — symmetric break). Ordered by follower count
  // when available; fallback to recent activity.
  const users = await prisma.user.findMany({
    where: {
      id: { notIn: [viewerId, ...blocked] },
      isVisible: true,
      OR: [{ isOnline: true }, { lastSeenAt: { gte: since } }],
    },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      bio: true,
      isOnline: true,
      _count: { select: { followers: true } },
    },
    orderBy: [{ followers: { _count: 'desc' } }, { lastSeenAt: 'desc' }],
    take: EXPLORE_USERS,
  });
  return users.map(u => ({
    id: u.id,
    username: u.username ?? '',
    displayName: u.displayName ?? u.username ?? '',
    avatarUrl: u.avatarUrl,
    bio: u.bio,
    isOnline: u.isOnline,
    followersCount: u._count.followers,
  }));
};

export const exploreService = {
  async feed(viewerId: string) {
    const [rooms, clubs, users] = await Promise.all([
      trendingRooms(),
      trendingClubs(),
      featuredUsers(viewerId),
    ]);
    return { rooms, clubs, users };
  },
};
