import { useEffect } from 'react';
import { getSocket } from '../../../shared/services/realtime/socketClient';
import { useGhostModeStore } from '../store/ghostModeStore';
import type { GeoCoords } from './useCurrentLocation';

/**
 * Pushes the user's location to the realtime server as it changes.
 * Respects Ghost Mode: when ON the coords are discarded client-side — the
 * server never learns the position.
 */
export const useLocationBroadcast = (coords: GeoCoords | null): void => {
  const isGhost = useGhostModeStore(s => s.isGhost);

  useEffect(() => {
    if (!coords || isGhost) return;
    let cancelled = false;
    void (async () => {
      const socket = await getSocket();
      if (cancelled || !socket) return;
      // Must match the backend listener name exactly (maps.handler.ts).
      // The server's LocationPayload only reads latitude/longitude.
      socket.emit('maps:update-location', {
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [coords, isGhost]);
};
