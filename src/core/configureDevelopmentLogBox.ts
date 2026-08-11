import { LogBox } from 'react-native';

const REANIMATED_REDUCED_MOTION_NOTICE =
  '[Reanimated] Reduced motion setting is enabled on this device.';

/**
 * Keep expected development-only notices from covering interactive controls.
 * The message remains in console/logcat and every other LogBox warning remains
 * visible; reduced-motion behavior itself is not disabled.
 */
export const configureDevelopmentLogBox = (): void => {
  if (!__DEV__) return;

  LogBox.ignoreLogs([REANIMATED_REDUCED_MOTION_NOTICE]);
};
