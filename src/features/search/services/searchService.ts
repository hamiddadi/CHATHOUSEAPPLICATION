import { apiClient } from '../../../shared/services/api/apiClient';
import type { Envelope } from '../../../shared/types/api';
import type { HouseSummary, UserSummary } from '../../../shared/types/domain';

/**
 * Multi-facet search API. One query, three buckets (users / clubs / rooms).
 * Requests run under auth and hit PG trigram indexes — cheap to call on
 * each keystroke with a debounce.
 */

export interface SearchRoomHit {
  id: string;
  title: string;
  description: string | null;
  topic: string | null;
  isLive: boolean;
  scheduledFor: string | null;
  host: UserSummary;
  listenersCount: number;
}

export interface SearchUserHit extends UserSummary {
  bio: string | null;
  isOnline: boolean;
}

export interface SearchResults {
  users: SearchUserHit[];
  clubs: HouseSummary[];
  rooms: SearchRoomHit[];
}

type SearchType = 'users' | 'clubs' | 'rooms' | 'all';

export const searchService = {
  async search(q: string, type: SearchType = 'all', limit = 20): Promise<SearchResults> {
    const res = await apiClient.get<Envelope<Partial<SearchResults>>>('/search', {
      params: { q, type, limit },
    });
    // Normalise missing facets to empty arrays so callers don't need to
    // guard for `undefined` depending on which type they asked for.
    return {
      users: res.data.data.users ?? [],
      clubs: res.data.data.clubs ?? [],
      rooms: res.data.data.rooms ?? [],
    };
  },

  async users(q: string, limit = 20): Promise<SearchUserHit[]> {
    const { users } = await this.search(q, 'users', limit);
    return users;
  },

  async clubs(q: string, limit = 20): Promise<HouseSummary[]> {
    const { clubs } = await this.search(q, 'clubs', limit);
    return clubs;
  },

  async rooms(q: string, limit = 20): Promise<SearchRoomHit[]> {
    const { rooms } = await this.search(q, 'rooms', limit);
    return rooms;
  },
};
