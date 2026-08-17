import { prisma } from '../../config/database';
import { getBlockedIdSet } from '../social/blocks';
import { discoverableRoomWhere } from './rooms.access';

const publicUser = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
} as const;

const FOLLOW_SPEAKER_WEIGHT = 3;
const TOPIC_MATCH_WEIGHT = 2;
const POPULARITY_CAP = 5;
const POPULARITY_BUCKET = 10;
const BASE_CANDIDATE_POOL = 200;
export const MAX_FEED_CANDIDATE_POOL = 1_000;

export interface RoomFeedFilters {
  topic?: string;
  following?: boolean;
  clubs?: boolean;
}

/**
 * Rank the bounded Hallway candidate window for one viewer. Keeping discovery
 * here isolates the read-heavy scoring path from room lifecycle transactions.
 */
export const getPersonalizedRoomFeed = async (
  viewerId: string,
  limit = 20,
  offset = 0,
  filters: RoomFeedFilters = {},
) => {
  const candidatePoolSize = Math.min(
    MAX_FEED_CANDIDATE_POOL,
    Math.max(BASE_CANDIDATE_POOL, offset + limit),
  );
  const topicLower = filters.topic?.toLowerCase();

  // Start the bounded candidate read alongside the viewer graph lookups. None
  // depends on the others, and serialising them adds a full database round trip
  // to this read-heavy endpoint.
  const candidatesPromise = prisma.room.findMany({
    where: {
      AND: [discoverableRoomWhere(viewerId)],
      isLive: true,
      endedAt: null,
      ...(filters.clubs ? { clubId: { not: null } } : {}),
      ...(topicLower
        ? {
            OR: [
              { topic: { equals: topicLower, mode: 'insensitive' as const } },
              { topics: { has: topicLower } },
              { title: { contains: topicLower, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      hostId: true,
      title: true,
      topic: true,
      topics: true,
      createdAt: true,
      participantCount: true,
      participants: {
        where: {
          leftAt: null,
          role: { not: 'LISTENER' as const },
          user: { deletedAt: null },
        },
        select: { userId: true },
      },
    },
    orderBy: { createdAt: 'desc' as const },
    take: candidatePoolSize,
  });

  const [viewer, followedIds, blockedIds, candidates] = await Promise.all([
    prisma.user.findUnique({
      where: { id: viewerId },
      select: { interests: true },
    }),
    prisma.follow
      .findMany({
        where: { followerId: viewerId, status: 'ACCEPTED' },
        select: { followingId: true },
      })
      .then(rows => new Set(rows.map(row => row.followingId))),
    getBlockedIdSet(viewerId),
    candidatesPromise,
  ]);
  // Phase 1 deliberately keeps the candidate window lightweight. Previously
  // every page hydrated every listener + public profile for up to 1,000 rooms,
  // only to discard almost all of them after ranking. Scoring needs only room
  // metadata, the denormalized active count and active speaker ids.
  const interests = new Set((viewer?.interests ?? []).map(interest => interest.toLowerCase()));

  const visibleCandidates = candidates
    .filter(room => !blockedIds.has(room.hostId))
    .map(room => ({
      ...room,
      participants: room.participants.filter(participant => !blockedIds.has(participant.userId)),
    }))
    .filter(room => {
      if (!filters.following || followedIds.has(room.hostId)) return true;
      return room.participants.some(participant => followedIds.has(participant.userId));
    });

  const scored = visibleCandidates.map(room => {
    const followSpeakerCount = room.participants.filter(participant =>
      followedIds.has(participant.userId),
    ).length;

    let topicMatch = 0;
    const roomTopics = new Set((room.topics ?? []).map(topic => topic.toLowerCase()));
    for (const interest of interests) {
      if (roomTopics.has(interest)) topicMatch += 1;
    }
    if (topicMatch === 0) {
      const roomText = `${room.topic ?? ''} ${room.title}`.toLowerCase();
      for (const interest of interests) {
        if (interest.length >= 3 && roomText.includes(interest)) topicMatch += 1;
      }
    }

    const popularity = Math.min(
      POPULARITY_CAP,
      Math.floor(room.participantCount / POPULARITY_BUCKET),
    );
    const score =
      followSpeakerCount * FOLLOW_SPEAKER_WEIGHT + topicMatch * TOPIC_MATCH_WEIGHT + popularity;
    return { room, score, followSpeakerCount };
  });

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return right.room.createdAt.getTime() - left.room.createdAt.getTime();
  });

  const selected = scored.slice(offset, offset + limit);
  if (selected.length === 0) return [];

  // Phase 2 hydrates only the selected page. Preserve the ranking order after
  // Prisma's unordered `id in (...)` lookup and remove blocked participants
  // before returning the public room payload.
  const hydrated = await prisma.room.findMany({
    // Re-check discovery policy at hydration time: a host can end or restrict a
    // room between the ranking query and this second round trip.
    where: {
      id: { in: selected.map(item => item.room.id) },
      AND: [discoverableRoomWhere(viewerId)],
      isLive: true,
      endedAt: null,
    },
    include: {
      host: { select: publicUser },
      participants: {
        where: { leftAt: null, user: { deletedAt: null } },
        select: {
          userId: true,
          role: true,
          isMuted: true,
          user: { select: publicUser },
        },
      },
      club: { select: { id: true, name: true, iconUrl: true } },
      _count: { select: { rsvps: true } },
    },
  });
  const byId = new Map(hydrated.map(room => [room.id, room]));

  return selected.flatMap(({ room: candidate, followSpeakerCount }) => {
    const room = byId.get(candidate.id);
    if (!room) return [];
    const participants = room.participants.filter(
      participant => !blockedIds.has(participant.userId),
    );
    return [
      {
        ...room,
        participants,
        knownSpeakers: participants
          .filter(
            participant => followedIds.has(participant.userId) && participant.role !== 'LISTENER',
          )
          .slice(0, 3)
          .map(participant => participant.user),
        hasKnownSpeakers: followSpeakerCount > 0,
      },
    ];
  });
};
