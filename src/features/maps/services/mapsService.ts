import { apiClient } from '../../../shared/services/api/apiClient';
import type { FollowerOnMap } from '../../../shared/types/domain';

interface Envelope<T> {
  success: true;
  data: T;
}

// Shape returned by GET /maps/followers (backend getFollowingOnMap select).
interface RawFollowerOnMap {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  lastSeenAt: string | null;
  currentRoomId: string | null;
  currentRoom: { id: string; title: string; isLive: boolean } | null;
}

const toFollowerOnMap = (r: RawFollowerOnMap): FollowerOnMap | null => {
  // The backend already filters to non-null coords, but guard so the domain
  // type stays honest (GeoPoint requires numbers).
  if (r.latitude == null || r.longitude == null) return null;
  const lastSeen = r.lastSeenAt ? new Date(r.lastSeenAt) : null;
  const minutesAgo = lastSeen
    ? Math.max(0, Math.round((Date.now() - lastSeen.getTime()) / 60_000))
    : 0;
  const live = r.currentRoom?.isLive ? r.currentRoom : null;
  return {
    id: r.id,
    username: r.username ?? '',
    displayName: r.displayName ?? r.username ?? '',
    avatarUrl: r.avatarUrl,
    location: {
      latitude: r.latitude,
      longitude: r.longitude,
      updatedAt: r.lastSeenAt ?? new Date().toISOString(),
    },
    presence: minutesAgo <= 5 ? 'online' : 'recently_active',
    liveRoomId: live?.id ?? null,
    liveRoomTitle: live?.title ?? null,
    lastSeenMinutesAgo: minutesAgo,
  };
};

export const mapsService = {
  /**
   * Initial roster of the people the caller follows who are on the map
   * (visible + online + recently located). The socket only streams coordinate
   * deltas afterwards, so this is the only source of full follower metadata.
   */
  async followersOnMap(): Promise<FollowerOnMap[]> {
    const res = await apiClient.get<Envelope<RawFollowerOnMap[]>>('/maps/followers');
    return res.data.data.map(toFollowerOnMap).filter((f): f is FollowerOnMap => f !== null);
  },
};
