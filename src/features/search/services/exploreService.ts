import { apiClient } from '../../../shared/services/api/apiClient';
import type { HouseSummary, UserSummary } from '../../../shared/types/domain';
import type { SearchRoomHit } from './searchService';

/**
 * The "Explore" feed — trending rooms, popular clubs, and suggested users.
 * Each facet is pre-ranked server-side; the client just renders.
 */

export interface ExploreUserHit extends UserSummary {
  bio: string | null;
  isOnline: boolean;
  followersCount: number;
}

export interface ExploreClubHit extends HouseSummary {
  liveRoomsCount: number;
}

export interface ExploreFeed {
  rooms: SearchRoomHit[];
  clubs: ExploreClubHit[];
  users: ExploreUserHit[];
}

interface Envelope<T> {
  success: true;
  data: T;
}

export const exploreService = {
  async feed(): Promise<ExploreFeed> {
    const res = await apiClient.get<Envelope<ExploreFeed>>('/explore');
    return res.data.data;
  },
};
