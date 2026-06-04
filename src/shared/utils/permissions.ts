// `PermissionsAndroid` is Android-only by name but the cross-platform
// pattern (Platform.OS checks below) is the established RN idiom for
// audio-permission helpers. The split-platform-components lint rule
// would force a `.android.ts` / `.ios.ts` split, which adds two files
// with one branch each — net negative for readability.
// eslint-disable-next-line react-native/split-platform-components
import { PermissionsAndroid, Platform } from 'react-native';

/**
 * Cross-platform microphone permission request. iOS uses the descriptions
 * declared in Info.plist (NSMicrophoneUsageDescription) and the system
 * prompts at first audio capture — we just trust the OS dialog.
 *
 * Android needs an explicit `RECORD_AUDIO` runtime permission since API 23.
 * The string is also declared in app.json's android.permissions array so
 * the manifest entry is generated at prebuild.
 */
export const requestAudioPermission = async (): Promise<boolean> => {
  if (Platform.OS === 'ios') {
    // iOS will prompt automatically when the audio engine actually starts
    // (LiveKit room.connect + microphone publish). Returning true here means
    // "we believe the user will be prompted"; if they decline we'll see
    // it surface as an error from the engine.
    return true;
  }

  if (Platform.OS === 'android') {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
      title: 'Permission micro',
      message: 'Chathouse a besoin de votre micro pour parler dans les rooms.',
      buttonPositive: 'Autoriser',
      buttonNegative: 'Refuser',
    });
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }

  // Web / unknown platforms — getUserMedia drives its own prompt.
  return true;
};

/**
 * Best-effort check without a prompt. Useful for an early UX decision
 * (e.g. show "enable mic" CTA when status is denied).
 */
export const checkAudioPermission = async (): Promise<'granted' | 'denied' | 'undetermined'> => {
  if (Platform.OS === 'android') {
    const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    return granted ? 'granted' : 'denied';
  }
  return 'undetermined';
};
