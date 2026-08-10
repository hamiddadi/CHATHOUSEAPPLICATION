// `PermissionsAndroid` is Android-only by name but the cross-platform
// pattern (Platform.OS checks below) is the established RN idiom for
// audio-permission helpers. The split-platform-components lint rule
// would force a `.android.ts` / `.ios.ts` split, which adds two files
// with one branch each — net negative for readability.
// eslint-disable-next-line react-native/split-platform-components
import { PermissionsAndroid, Platform } from 'react-native';
import { permissions as mediaPermissions } from '@livekit/react-native-webrtc';
import { i18n } from '../../core/i18n';

export type AudioPermissionStatus = 'granted' | 'denied' | 'undetermined';

const androidApiLevel = (): number =>
  typeof Platform.Version === 'number' ? Platform.Version : Number.parseInt(Platform.Version, 10);

/**
 * Android 12+ protects Bluetooth audio-device access separately. A denial does
 * not block speaker/handset audio, so callers should treat this as optional.
 */
export const requestBluetoothAudioPermission = async (): Promise<boolean> => {
  if (Platform.OS !== 'android' || androidApiLevel() < 31) return true;

  const permission = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
  if (await PermissionsAndroid.check(permission)) return true;
  const result = await PermissionsAndroid.request(permission, {
    title: i18n.t('permissions.bluetoothAudioTitle'),
    message: i18n.t('permissions.bluetoothAudioBody'),
    buttonPositive: i18n.t('permissions.allow'),
    buttonNegative: i18n.t('permissions.deny'),
  });
  return result === PermissionsAndroid.RESULTS.GRANTED;
};

/**
 * Cross-platform microphone permission request. iOS uses the WebRTC native
 * bridge backed by AVCaptureDevice to query, request and verify the decision;
 * the prompt text comes from NSMicrophoneUsageDescription in Info.plist.
 *
 * Android needs an explicit `RECORD_AUDIO` runtime permission since API 23.
 * Android 12+ also asks for optional Bluetooth-device access after the mic is
 * granted so headset routing works without blocking handset audio on denial.
 */
export const requestAudioPermission = async (): Promise<boolean> => {
  if (Platform.OS === 'ios') {
    // The WebRTC native bridge delegates to AVCaptureDevice on iOS. Querying
    // before and after the prompt prevents us from assuming that capture is
    // allowed before the operating system has confirmed the decision.
    const current = await checkAudioPermission();
    if (current === 'granted') return true;
    if (current === 'denied') return false;

    const granted = await mediaPermissions.request({ name: 'microphone' });
    if (granted !== true) return false;

    return (await checkAudioPermission()) === 'granted';
  }

  if (Platform.OS === 'android') {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
      title: i18n.t('permissions.microphoneTitle'),
      message: i18n.t('permissions.microphoneBody'),
      buttonPositive: i18n.t('permissions.allow'),
      buttonNegative: i18n.t('permissions.deny'),
    });
    const microphoneGranted = result === PermissionsAndroid.RESULTS.GRANTED;
    if (microphoneGranted) {
      // Optional: room audio still works through the handset if this is denied.
      await requestBluetoothAudioPermission().catch(() => false);
    }
    return microphoneGranted;
  }

  // Web / unknown platforms — getUserMedia drives its own prompt.
  return true;
};

/**
 * Best-effort check without a prompt. Useful for an early UX decision
 * (e.g. show "enable mic" CTA when status is denied).
 */
export const checkAudioPermission = async (): Promise<AudioPermissionStatus> => {
  if (Platform.OS === 'android') {
    const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    return granted ? 'granted' : 'denied';
  }

  if (Platform.OS === 'ios') {
    const status: unknown = await mediaPermissions.query({ name: 'microphone' });
    if (status === mediaPermissions.RESULT.GRANTED) return 'granted';
    if (status === mediaPermissions.RESULT.DENIED) return 'denied';
    return 'undetermined';
  }

  return 'undetermined';
};
