import { useEffect, useState } from 'react';
import { env } from '../../../config/env';
import { MOCK_FOLLOWERS_ON_MAP } from '../../../shared/mocks/followersOnMap.mock';
import { getSocket } from '../../../shared/services/realtime/socketClient';
import { mapsService } from '../services/mapsService';
import type { FollowerOnMap } from '../../../shared/types/domain';

/** Backend `maps:user-moved` payload — partial: only the moving user's coords. */
interface MapsUserMoved {
  userId: string;
  latitude: number;
  longitude: number;
}

/** Backend `maps:user-offline` payload. */
interface MapsUserOffline {
  userId: string;
}

/**
 * Backend `map:user_update` payload — partial mic/room-audio state for one
 * user, fanned out to the `maps:presence` channel when they mute/unmute, take
 * the stage, or join/leave a room. Carries no coordinates (those still arrive
 * via `maps:user-moved`); it's a pure state delta merged surgically below.
 */
interface MapUserUpdate {
  userId: string;
  isSpeaking?: boolean;
  isMuted?: boolean;
  isListener?: boolean;
  /** false → the user left the room; clears every room-audio flag. */
  isInRoom?: boolean;
}

/**
 * Subscribes to followers presence via WebSocket.
 * Falls back to `MOCK_FOLLOWERS_ON_MAP` when `env.REALTIME_ENABLED === false`
 * so the feature is demo-able without a server.
 *
 * Event contract is dictated by the backend (backend/src/socket/handlers/maps.handler.ts):
 * - The socket auto-joins the `maps:presence` channel — there is NO subscribe message.
 * - The server emits `maps:user-moved` ({ userId, latitude, longitude }) and
 *   `maps:user-offline` ({ userId }). It never pushes a full follower roster.
 *
 * Roster strategy: the socket only carries coordinate deltas (no username/
 * avatar/presence), so the initial roster comes from the REST snapshot
 * GET /maps/followers (mapsService.followersOnMap). The socket then relocates
 * already-known followers on `maps:user-moved` and removes them on
 * `maps:user-offline`. In demo mode (REALTIME disabled) we seed from the mock.
 */
export const useFollowersOnMap = (): FollowerOnMap[] => {
  // Realtime: start empty and fill from the REST snapshot below. Demo mode
  // (no realtime): seed from the mock roster so the feature is browsable.
  const [followers, setFollowers] = useState<FollowerOnMap[]>(() =>
    env.REALTIME_ENABLED ? [] : [...MOCK_FOLLOWERS_ON_MAP],
  );

  useEffect(() => {
    if (!env.REALTIME_ENABLED) return;
    let cancelled = false;

    // 1) Seed the roster with full follower metadata from the REST snapshot.
    void mapsService
      .followersOnMap()
      .then(roster => {
        if (!cancelled) setFollowers(roster);
      })
      .catch(() => {
        // Snapshot failed — keep an empty roster; socket deltas can't
        // materialise pins on their own, so there's nothing to relocate yet.
      });

    const onMoved = (m: MapsUserMoved) => {
      if (cancelled) return;
      // Only relocate followers we already have full metadata for — the socket
      // payload lacks username/avatar/presence so we can't safely materialise a
      // new pin from it.
      setFollowers(prev =>
        prev.map(f =>
          f.id === m.userId
            ? {
                ...f,
                // A follower emitting moves is by definition active right now —
                // refresh freshness so the card doesn't show a stale "Nm ago".
                presence: 'online',
                lastSeenMinutesAgo: 0,
                location: { ...f.location, latitude: m.latitude, longitude: m.longitude },
              }
            : f,
        ),
      );
    };

    const onOffline = (p: MapsUserOffline) => {
      if (!cancelled) setFollowers(prev => prev.filter(f => f.id !== p.userId));
    };

    // Surgical mic/room-audio patch: only the matching follower is rewritten
    // (a partial spread merge), every other entry keeps its identity so its
    // marker doesn't re-render — exactly the per-user update the live badge
    // needs. NEVER replace the whole array on a mic toggle, or every marker on
    // the map re-rasterizes (expensive on Android).
    const onUserUpdate = (u: MapUserUpdate) => {
      if (cancelled) return;
      setFollowers(prev =>
        prev.map(f => {
          if (f.id !== u.userId) return f;
          // Leaving a room clears every room-audio signal so the marker falls
          // back to the plain "online" badge.
          if (u.isInRoom === false) {
            return {
              ...f,
              presence: 'online',
              lastSeenMinutesAgo: 0,
              liveRoomId: null,
              liveRoomTitle: null,
              isSpeaking: false,
              isMuted: false,
              isListener: false,
            };
          }
          return {
            ...f,
            presence: 'online',
            lastSeenMinutesAgo: 0,
            ...(u.isSpeaking !== undefined && { isSpeaking: u.isSpeaking }),
            ...(u.isMuted !== undefined && { isMuted: u.isMuted }),
            ...(u.isListener !== undefined && { isListener: u.isListener }),
          };
        }),
      );
    };

    void (async () => {
      const socket = await getSocket();
      if (cancelled || !socket) return;
      socket.on('maps:user-moved', onMoved);
      socket.on('maps:user-offline', onOffline);
      socket.on('map:user_update', onUserUpdate);
    })();

    return () => {
      cancelled = true;
      // Don't disconnect the shared socket here — other consumers may still need it.
      // Detach our specific handler references so we don't strip other listeners.
      void getSocket().then(s => {
        s?.off('maps:user-moved', onMoved);
        s?.off('maps:user-offline', onOffline);
        s?.off('map:user_update', onUserUpdate);
      });
    };
  }, []);

  return followers;
};
