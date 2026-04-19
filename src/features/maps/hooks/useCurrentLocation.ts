import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';

const UPDATE_INTERVAL_MS = 30_000;
const UPDATE_DISTANCE_M = 25;

export type LocationPermission = 'unknown' | 'granted' | 'denied' | 'disabled';

interface UseCurrentLocationReturn {
  permission: LocationPermission;
  coords: Location.LocationObjectCoords | null;
  error: string | null;
  requestAgain: () => Promise<void>;
}

/**
 * Subscribes to foreground location updates at most every 30s / 25m.
 * The hook does NOT push to the backend — that's `useLocationBroadcast`'s job.
 */
export const useCurrentLocation = (): UseCurrentLocationReturn => {
  const [permission, setPermission] = useState<LocationPermission>('unknown');
  const [coords, setCoords] = useState<Location.LocationObjectCoords | null>(null);
  const [error, setError] = useState<string | null>(null);
  const subRef = useRef<Location.LocationSubscription | null>(null);

  const start = useCallback(async () => {
    try {
      const enabled = await Location.hasServicesEnabledAsync();
      if (!enabled) {
        setPermission('disabled');
        return;
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPermission('denied');
        return;
      }
      setPermission('granted');

      const initial = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setCoords(initial.coords);

      subRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: UPDATE_INTERVAL_MS,
          distanceInterval: UPDATE_DISTANCE_M,
        },
        pos => setCoords(pos.coords),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void start();
    return () => {
      subRef.current?.remove();
      subRef.current = null;
    };
  }, [start]);

  return { permission, coords, error, requestAgain: start };
};
