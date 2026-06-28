import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, PermissionsAndroid } from 'react-native';
import Geolocation from '@react-native-community/geolocation';

const UPDATE_INTERVAL_MS = 30_000;
const UPDATE_DISTANCE_M = 25;
// Guard against devices with no GPS fix: getCurrentPosition can otherwise stay
// pending indefinitely, leaving the user stuck on the "Locating you" loader.
const INITIAL_FIX_TIMEOUT_MS = 8_000;

export type LocationPermission = 'unknown' | 'granted' | 'denied' | 'disabled';

/**
 * Minimal coords shape used across the maps feature (de-Expo: replaces
 * expo-location's LocationObjectCoords). Structurally compatible with
 * @react-native-community/geolocation's `position.coords`.
 */
export interface GeoCoords {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  heading: number | null;
  speed: number | null;
}

interface UseCurrentLocationReturn {
  permission: LocationPermission;
  coords: GeoCoords | null;
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
 * Subscribes to foreground location updates at most every 30s / 25m
 * (de-Expo: was expo-location; now @react-native-community/geolocation +
 * PermissionsAndroid). Does NOT push to the backend — that's
 * `useLocationBroadcast`'s job.
 */
export const useCurrentLocation = (): UseCurrentLocationReturn => {
  const [permission, setPermission] = useState<LocationPermission>('unknown');
  const [coords, setCoords] = useState<GeoCoords | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  // `start` runs several awaits (consent Alert, permission request, 8s GPS race)
  // and is also exposed as `requestAgain`, so it can resolve after the screen
  // unmounts. Guard every post-await setState against a stale write.
  const mountedRef = useRef(true);

  const clearWatch = useCallback(() => {
    if (watchIdRef.current !== null) {
      Geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    try {
      const already = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      );

      if (!already) {
        // GDPR consent pre-prompt before the OS dialog.
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
        if (!mountedRef.current) return;
        if (!userConsented) {
          setPermission('denied');
          return;
        }

        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        );
        if (!mountedRef.current) return;
        if (result !== PermissionsAndroid.RESULTS.GRANTED) {
          setPermission('denied');
          return;
        }
      }
      setPermission('granted');

      // Race the first fix against a timeout so a missing GPS fix can't hang
      // forever. On timeout we leave `coords` null and rely on watchPosition
      // below to deliver the position when it becomes available.
      let raceTimer: ReturnType<typeof setTimeout> | undefined;
      const initial = await Promise.race<{ coords: GeoCoords } | null>([
        new Promise<{ coords: GeoCoords } | null>(resolve => {
          Geolocation.getCurrentPosition(
            pos => resolve({ coords: pos.coords }),
            err => {
              // code 2 = POSITION_UNAVAILABLE (device location services off).
              if (err.code === 2 && mountedRef.current) setPermission('disabled');
              resolve(null);
            },
            { enableHighAccuracy: false, timeout: INITIAL_FIX_TIMEOUT_MS, maximumAge: 10_000 },
          );
        }),
        new Promise<null>(resolve => {
          raceTimer = setTimeout(() => resolve(null), INITIAL_FIX_TIMEOUT_MS);
        }),
      ]);
      // Whichever side lost the race leaves a pending timer; clear it so it never
      // fires after the fix already arrived (or after the component unmounts).
      if (raceTimer) clearTimeout(raceTimer);
      if (!mountedRef.current) return;
      if (initial) setCoords(initial.coords);
      setReady(true);

      // Defensive: drop any prior watcher before creating a new one, so a rapid
      // re-invocation of start() (e.g. double-tap "Grant access") can't leak it.
      clearWatch();
      watchIdRef.current = Geolocation.watchPosition(
        pos => {
          if (mountedRef.current) setCoords(pos.coords);
        },
        () => undefined,
        {
          enableHighAccuracy: false,
          distanceFilter: UPDATE_DISTANCE_M,
          interval: UPDATE_INTERVAL_MS,
        },
      );
    } catch (e) {
      if (!mountedRef.current) return;
      setError((e as Error).message);
      setReady(true);
    }
  }, [clearWatch]);

  useEffect(() => {
    mountedRef.current = true;
    void start();
    return () => {
      mountedRef.current = false;
      clearWatch();
    };
  }, [start, clearWatch]);

  return { permission, coords, error, requestAgain: start, ready };
};
