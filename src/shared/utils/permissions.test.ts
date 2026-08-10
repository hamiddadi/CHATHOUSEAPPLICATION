import { permissions as mediaPermissions } from '@livekit/react-native-webrtc';
import { PermissionsAndroid, Platform } from 'react-native';
import { i18n } from '../../core/i18n';
import { checkAudioPermission, requestAudioPermission } from './permissions';

const queryPermission = mediaPermissions.query as jest.Mock;
const requestPermission = mediaPermissions.request as jest.Mock;

describe('audio permissions', () => {
  const originalOs = Platform.OS;
  const originalVersion = Platform.Version;

  beforeEach(() => {
    queryPermission.mockReset().mockResolvedValue(mediaPermissions.RESULT.PROMPT);
    requestPermission.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOs, configurable: true });
    Object.defineProperty(Platform, 'Version', { value: originalVersion, configurable: true });
    jest.restoreAllMocks();
  });

  it('requests optional Bluetooth access after microphone access on Android 12+', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    Object.defineProperty(Platform, 'Version', { value: 31, configurable: true });
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
    const request = jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);

    await expect(requestAudioPermission()).resolves.toBe(true);
    expect(request).toHaveBeenNthCalledWith(1, PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
      title: i18n.t('permissions.microphoneTitle'),
      message: i18n.t('permissions.microphoneBody'),
      buttonPositive: i18n.t('permissions.allow'),
      buttonNegative: i18n.t('permissions.deny'),
    });
    expect(request).toHaveBeenNthCalledWith(2, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT, {
      title: i18n.t('permissions.bluetoothAudioTitle'),
      message: i18n.t('permissions.bluetoothAudioBody'),
      buttonPositive: i18n.t('permissions.allow'),
      buttonNegative: i18n.t('permissions.deny'),
    });
  });

  it('keeps handset audio available when optional Bluetooth access is denied', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    Object.defineProperty(Platform, 'Version', { value: 36, configurable: true });
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
    jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValueOnce(PermissionsAndroid.RESULTS.GRANTED)
      .mockResolvedValueOnce(PermissionsAndroid.RESULTS.DENIED);

    await expect(requestAudioPermission()).resolves.toBe(true);
  });

  it('does not request Bluetooth when RECORD_AUDIO is denied on Android', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    Object.defineProperty(Platform, 'Version', { value: 36, configurable: true });
    const request = jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);

    await expect(requestAudioPermission()).resolves.toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      expect.any(Object),
    );
  });

  it('returns an already-granted iOS permission without showing another prompt', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    queryPermission.mockResolvedValue(mediaPermissions.RESULT.GRANTED);

    await expect(requestAudioPermission()).resolves.toBe(true);
    expect(queryPermission).toHaveBeenCalledWith({ name: 'microphone' });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('requests and verifies an undetermined iOS microphone permission', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    queryPermission
      .mockResolvedValueOnce(mediaPermissions.RESULT.PROMPT)
      .mockResolvedValueOnce(mediaPermissions.RESULT.GRANTED);

    await expect(requestAudioPermission()).resolves.toBe(true);
    expect(requestPermission).toHaveBeenCalledWith({ name: 'microphone' });
    expect(queryPermission).toHaveBeenCalledTimes(2);
  });

  it('returns false without prompting again after iOS denied the microphone', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    queryPermission.mockResolvedValue(mediaPermissions.RESULT.DENIED);

    await expect(requestAudioPermission()).resolves.toBe(false);
    await expect(checkAudioPermission()).resolves.toBe('denied');
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('does not turn a native iOS bridge error into a false permission grant', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const nativeError = new Error('permission bridge unavailable');
    queryPermission.mockRejectedValue(nativeError);

    await expect(requestAudioPermission()).rejects.toBe(nativeError);
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
