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
    prisma.room.findMany({
      where: {
        AND: [discoverableRoomWhere(viewerId)],
        isLive: true,
        endedAt: null,
        ...(filters.clubs ? { clubId: { not: null } } : {}),
        ...(topicLower
          ? {
              OR: [
                { topic: { equals: topicLower, mode: 'insensitive' } },
                { topics: { has: topicLower } },
                { title: { contains: topicLower, mode: 'insensitive' } },
              ],
            }
          : {}),
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
      orderBy: { createdAt: 'desc' },
      take: candidatePoolSize,
    }),
  ]);
  const interests = new Set((viewer?.interests ?? []).map(interest => interest.toLowerCase()));

  const visibleCandidates = candidates
    .filter(room => !blockedIds.has(room.hostId))
    .map(room => ({
      ...room,
      participants: room.participants.filter(participant => !blockedIds.has(participant.userId)),
    }))
    .filter(room => {
      if (!filters.following || followedIds.has(room.hostId)) return true;
      return room.participants.some(
        participant => participant.role !== 'LISTENER' && followedIds.has(participant.userId),
      );
    });

  const scored = visibleCandidates.map(room => {
    const speakers = room.participants.filter(participant => participant.role !== 'LISTENER');
    const followSpeakerCount = speakers.filter(participant =>
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
      Math.floor(room.participants.length / POPULARITY_BUCKET),
    );
    const score =
      followSpeakerCount * FOLLOW_SPEAKER_WEIGHT + topicMatch * TOPIC_MATCH_WEIGHT + popularity;
    return { room, score, followSpeakerCount };
  });

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return right.room.createdAt.getTime() - left.room.createdAt.getTime();
  });

  return scored.slice(offset, offset + limit).map(({ room, followSpeakerCount }) => ({
    ...room,
    knownSpeakers: room.participants
      .filter(participant => followedIds.has(participant.userId) && participant.role !== 'LISTENER')
      .slice(0, 3)
      .map(participant => participant.user),
    hasKnownSpeakers: followSpeakerCount > 0,
  }));
};
