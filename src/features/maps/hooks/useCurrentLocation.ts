import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, PermissionsAndroid, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Geolocation from '@react-native-community/geolocation';
import { i18n } from '../../../core/i18n';
import { createConsentRecord, parseCurrentConsentRecord } from '../../privacy/consentRecord';

const UPDATE_INTERVAL_MS = 30_000;
const UPDATE_DISTANCE_M = 25;
// Guard against devices with no GPS fix: getCurrentPosition can otherwise stay
// pending indefinitely, leaving the user stuck on the "Locating you" loader.
const INITIAL_FIX_TIMEOUT_MS = 8_000;
const LOCATION_CONSENT_KEY = 'chathouse.consent.location.v2';

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

  const start = useCallback(
    async (explicitRetry = false) => {
      try {
        let already = false;
        if (Platform.OS === 'android') {
          const [fine, coarse] = await Promise.all([
            PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION),
            PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION),
          ]);
          already = fine || coarse;
        }

        // The in-app notice is independent from the OS permission. A permission
        // granted in system settings must not silently stand in for acceptance of
        // ChatHouse's current purpose-specific notice.
        const rawConsent = await AsyncStorage.getItem(LOCATION_CONSENT_KEY).catch(() => null);
        const priorConsent = parseCurrentConsentRecord(rawConsent, 'location');
        if (priorConsent?.status === 'denied' && !explicitRetry) {
          if (!mountedRef.current) return;
          setPermission('denied');
          setReady(true);
          return;
        }

        let userConsented = priorConsent?.status === 'granted';
        if (!userConsented) {
          userConsented = await new Promise<boolean>(resolve => {
            Alert.alert(
              i18n.t('explorer.maps.consentTitle', 'Location Consent'),
              i18n.t(
                'explorer.maps.consentBody',
                'ChatHouse uses your location to show users who choose to be visible on the map. If you enable visibility, those users can also see your live position. Turning sharing off clears your coordinates; inactive locations are also purged automatically.',
              ),
              [
                {
                  text: i18n.t('explorer.maps.consentDecline', 'Not Now'),
                  style: 'cancel',
                  onPress: () => resolve(false),
                },
                {
                  text: i18n.t('explorer.maps.consentAccept', 'I Understand'),
                  onPress: () => resolve(true),
                },
              ],
            );
          });
          if (!mountedRef.current) return;
          if (!userConsented) {
            await AsyncStorage.setItem(
              LOCATION_CONSENT_KEY,
              JSON.stringify(createConsentRecord('location', 'denied')),
            ).catch(() => undefined);
            setPermission('denied');
            setReady(true);
            return;
          }
          // Fail closed: do not start location processing if the affirmative
          // choice cannot be recorded durably.
          await AsyncStorage.setItem(
            LOCATION_CONSENT_KEY,
            JSON.stringify(createConsentRecord('location', 'granted')),
          );
        }

        if (!already) {
          if (Platform.OS === 'android') {
            // Android 12+ requires COARSE and FINE to be requested together so
            // the user can choose approximate location without a false denial.
            const results = await PermissionsAndroid.requestMultiple([
              PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
              PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            ]);
            if (!mountedRef.current) return;
            const granted =
              results[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] ===
                PermissionsAndroid.RESULTS.GRANTED ||
              results[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION] ===
                PermissionsAndroid.RESULTS.GRANTED;
            if (!granted) {
              setPermission('denied');
              return;
            }
          } else if (Platform.OS === 'ios') {
            const granted = await new Promise<boolean>(resolve => {
              Geolocation.requestAuthorization(
                () => resolve(true),
                () => resolve(false),
              );
            });
            if (!mountedRef.current) return;
            if (!granted) {
              setPermission('denied');
              return;
            }
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
    },
    [clearWatch],
  );

  useEffect(() => {
    mountedRef.current = true;
    void start(false);
    return () => {
      mountedRef.current = false;
      clearWatch();
    };
  }, [start, clearWatch]);

  const requestAgain = useCallback(() => start(true), [start]);

  return { permission, coords, error, requestAgain, ready };
};
