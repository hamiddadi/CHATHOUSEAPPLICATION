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

// How often we re-pull the REST roster. The socket relocates users we already
// know, but it CANNOT materialise a pin for someone who wasn't in the last
// snapshot — the `maps:user-moved` payload has no username/avatar. Polling is
// what surfaces people who just came online or entered the radius. 45s keeps
// it fresh without hammering the endpoint (the location write is the hot path).
const ROSTER_REFRESH_MS = 45_000;

/**
 * Roster of EVERY nearby user on the map — visible + online + recently
 * located, within `radiusKm` of the caller (default = backend's 25 km). This
 * is the "nearby people" view, NOT the "followers only" view (useFollowersOnMap).
 *
 * Event contract is dictated by the backend (backend/src/socket/handlers/maps.handler.ts):
 * - The socket auto-joins the `maps:presence` channel — there is NO subscribe message.
 * - The server fans out `maps:user-moved` ({ userId, latitude, longitude }) and
 *   `maps:user-offline` ({ userId }) for ALL visible users, to every viewer.
 *
 * Roster strategy: the REST snapshot (GET /maps/users) is the only source of
 * full user metadata. The socket relocates already-known users on
 * `maps:user-moved` and drops them on `maps:user-offline`; periodic refetch
 * brings in newcomers. In demo mode (REALTIME disabled) we seed from the mock.
 */
export const useNearbyOnMap = (radiusKm?: number): FollowerOnMap[] => {
  // Realtime: start empty and fill from the REST snapshot below. Demo mode
  // (no realtime): seed from the mock roster so the feature is browsable.
  const [people, setPeople] = useState<FollowerOnMap[]>(() =>
    env.REALTIME_ENABLED ? [] : [...MOCK_FOLLOWERS_ON_MAP],
  );

  useEffect(() => {
    if (!env.REALTIME_ENABLED) return;
    let cancelled = false;

    // 1) Seed (and periodically refresh) the roster from the REST snapshot.
    const pull = (): void => {
      void mapsService
        .nearbyOnMap(radiusKm)
        .then(roster => {
          if (!cancelled) setPeople(roster);
        })
        .catch(() => {
          // Snapshot failed — keep whatever we have; socket deltas can't
          // materialise pins on their own, so there's nothing to relocate yet.
        });
    };
    pull();
    const refresh = setInterval(pull, ROSTER_REFRESH_MS);

    const onMoved = (m: MapsUserMoved): void => {
      if (cancelled) return;
      // Only relocate users we already have full metadata for — the socket
      // payload lacks username/avatar/presence so we can't safely materialise a
      // new pin from it (the next REST refresh will pick newcomers up).
      setPeople(prev =>
        prev.map(p =>
          p.id === m.userId
            ? {
                ...p,
                // A user emitting moves is by definition active right now —
                // refresh freshness so the card doesn't show a stale "Nm ago".
                presence: 'online',
                lastSeenMinutesAgo: 0,
                location: { ...p.location, latitude: m.latitude, longitude: m.longitude },
              }
            : p,
        ),
      );
    };

    const onOffline = (p: MapsUserOffline): void => {
      if (!cancelled) setPeople(prev => prev.filter(x => x.id !== p.userId));
    };

    void (async () => {
      const socket = await getSocket();
      if (cancelled || !socket) return;
      socket.on('maps:user-moved', onMoved);
      socket.on('maps:user-offline', onOffline);
    })();

    return () => {
      cancelled = true;
      clearInterval(refresh);
      // Don't disconnect the shared socket here — other consumers may still need it.
      // Detach our specific handler references so we don't strip other listeners.
      void getSocket().then(s => {
        s?.off('maps:user-moved', onMoved);
        s?.off('maps:user-offline', onOffline);
      });
    };
  }, [radiusKm]);

  return people;
};
