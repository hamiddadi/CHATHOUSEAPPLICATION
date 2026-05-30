import type { Prisma } from '@prisma/client';
import { prisma } from '../../../config/database';

/**
 * Extended live-room search with language/topic filters (Module 13.4 /
 * SEARCH-010). The original search.service ships text matching but no
 * faceted filters. This wrapper composes the same Prisma layer with
 * topic[] and a synthetic language filter (derived from Room.topic which
 * we cap as "lang:<iso>" convention) so we don't need to alter the schema.
 */
const ROOM_SELECT = {
  id: true,
  title: true,
  description: true,
  topic: true,
  topics: true,
  isLive: true,
  scheduledFor: true,
  participantCount: true,
  host: {
    select: { id: true, username: true, displayName: true, avatarUrl: true },
  },
} as const satisfies Prisma.RoomSelect;

export interface SearchRoomsFilter {
  q?: string;
  topic?: string;
  language?: string; // ISO-639-1 (en, fr, ar, …)
  liveOnly?: boolean;
  limit?: number;
}

export const searchExtService = {
  async rooms(filter: SearchRoomsFilter) {
    const limit = Math.min(filter.limit ?? 30, 100);
    const where: Prisma.RoomWhereInput = {
      isPrivate: false,
      endedAt: null,
    };
    if (filter.liveOnly !== false) where.isLive = true;

    if (filter.q && filter.q.trim().length > 0) {
      const q = filter.q.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { topic: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (filter.topic) {
      where.topics = { has: filter.topic };
    }

    if (filter.language) {
      // Convention: when host selects a language, it's stored as one of
      // the entries in Room.topics under the form "lang:<iso>".
      where.topics = where.topics
        ? { hasEvery: [filter.topic ?? '', `lang:${filter.language}`].filter(Boolean) }
        : { has: `lang:${filter.language}` };
    }

    return prisma.room.findMany({
      where,
      select: ROOM_SELECT,
      orderBy: [{ participantCount: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });
  },
};
