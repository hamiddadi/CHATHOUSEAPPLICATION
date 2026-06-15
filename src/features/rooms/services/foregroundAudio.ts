/**
 * JS wrapper around the Android `RoomForeground` native module
 * (android/app/src/main/java/com/chathouse/audio/RoomForegroundModule.kt).
 *
 * Keeps a foreground service running while a LiveKit audio room is active so
 * Android doesn't suspend the process — and the audio — when the app is
 * backgrounded or the screen locks. No-op on iOS and anywhere the native
 * module is absent (e.g. Expo Go / unit tests), so call sites stay unguarded.
 */
import { NativeModules, Platform } from 'react-native';

interface RoomForegroundNative {
  start(): Promise<boolean>;
  stop(): Promise<boolean>;
}

const native: RoomForegroundNative | null =
  Platform.OS === 'android'
    ? ((NativeModules as { RoomForeground?: RoomForegroundNative }).RoomForeground ?? null)
    : null;

/** Promote the audio foreground service. Best-effort — failures never bubble. */
export const startRoomForeground = async (): Promise<void> => {
  if (!native) return;
  try {
    await native.start();
  } catch {
    /* noop — a missing FGS only costs background audio, not the room itself */
  }
};

/** Stop the audio foreground service. Best-effort. */
export const stopRoomForeground = async (): Promise<void> => {
  if (!native) return;
  try {
    await native.stop();
  } catch {
    /* noop */
  }
};
