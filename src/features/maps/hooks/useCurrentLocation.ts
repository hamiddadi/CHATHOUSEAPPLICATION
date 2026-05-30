import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as Location from 'expo-location';

const UPDATE_INTERVAL_MS = 30_000;
const UPDATE_DISTANCE_M = 25;
// Guard against devices with no GPS fix: getCurrentPositionAsync can otherwise
// stay pending indefinitely, leaving the user stuck on the "Locating you" loader.
const INITIAL_FIX_TIMEOUT_MS = 8_000;

export type LocationPermission = 'unknown' | 'granted' | 'denied' | 'disabled';

interface UseCurrentLocationReturn {
  permission: LocationPermission;
  coords: Location.LocationObjectCoords | null;
  error: string | null;
  requestAgain: () => Promise<void>;
  /**
   * True once the initial fix attempt has finished (fix obtained OR timed out).
   * Lets the map fall back to a default centre instead of blocking forever on
   * the "Locating you" loader when no GPS fix is available.
   */
  ready: boolean;
}

/**
 * Subscribes to foreground location updates at most every 30s / 25m.
 * The hook does NOT push to the backend — that's `useLocationBroadcast`'s job.
 */
export const useCurrentLocation = (): UseCurrentLocationReturn => {
  const [permission, setPermission] = useState<LocationPermission>('unknown');
  const [coords, setCoords] = useState<Location.LocationObjectCoords | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const subRef = useRef<Location.LocationSubscription | null>(null);

  const start = useCallback(async () => {
    try {
      const enabled = await Location.hasServicesEnabledAsync();
      if (!enabled) {
        setPermission('disabled');
        return;
      }

      const currentStatus = await Location.getForegroundPermissionsAsync();

      if (currentStatus.status !== 'granted' && currentStatus.canAskAgain) {
        // GDPR Consent Pre-prompt
        const userConsented = await new Promise<boolean>(resolve => {
          Alert.alert(
            'Location Consent',
            'ChatHouse uses your location to show you friends nearby on the map. Your location data will be stored securely on our servers and automatically deleted after 30 days of inactivity. You can turn this off anytime using Ghost Mode.',
            [
              { text: 'Not Now', style: 'cancel', onPress: () => resolve(false) },
              { text: 'I Understand', onPress: () => resolve(true) },
            ],
          );
        });

        if (!userConsented) {
          setPermission('denied');
          return;
        }
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPermission('denied');
        return;
      }
      setPermission('granted');

      // Race the first fix against a timeout so a missing GPS fix can't hang
      // the promise forever. If it times out we leave `coords` null and rely on
      // watchPositionAsync below to deliver the position when it becomes available.
      const initial = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>(resolve => setTimeout(() => resolve(null), INITIAL_FIX_TIMEOUT_MS)),
      ]);
      if (initial) setCoords(initial.coords);
      setReady(true);

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
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void start();
    return () => {
      subRef.current?.remove();
      subRef.current = null;
    };
  }, [start]);

  return { permission, coords, error, requestAgain: start, ready };
};
