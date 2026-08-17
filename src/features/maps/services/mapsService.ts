import { apiClient } from '../../../shared/services/api/apiClient';
import type { Envelope } from '../../../shared/types/api';
import type { FollowerOnMap } from '../../../shared/types/domain';

// Shape returned by GET /maps/users (all opted-in, non-blocked visible users).
export interface RawMapUser {
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

export const toMapUser = (r: RawMapUser): FollowerOnMap | null => {
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
    // The roster select only tells us *whether* they're in a live room, not
    // their stage role / mute state — so seed them as a listener (blue badge).
    // The socket `map:user_update` event refines this to speaking/muted in real
    // time once they take the stage or toggle their mic.
    isListener: live != null,
  };
};

export const mapsService = {
  /**
   * Initial roster of all opted-in, non-blocked visible users who are online
   * and recently located. Full socket snapshots keep it current afterwards.
   */
  async followersOnMap(): Promise<FollowerOnMap[]> {
    const res = await apiClient.get<Envelope<RawMapUser[]>>('/maps/users');
    return res.data.data.map(toMapUser).filter((f): f is FollowerOnMap => f !== null);
  },
};
