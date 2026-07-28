import { PermissionsAndroid, Platform } from 'react-native';
import { requestAudioPermission } from './permissions';

describe('Android audio permissions', () => {
  const originalOs = Platform.OS;
  const originalVersion = Platform.Version;

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
    expect(request).toHaveBeenNthCalledWith(
      1,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      expect.any(Object),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      expect.any(Object),
    );
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
});
