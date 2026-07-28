import { act, renderHook } from '@testing-library/react-native';
import { PermissionsAndroid, Platform } from 'react-native';
import {
  audioRecorderPlayer,
  useVoicePlayback,
} from '../../../shared/services/audio/voicePlayback';
import { useVoiceRecorder } from './useVoiceRecorder';

describe('useVoiceRecorder microphone permission', () => {
  const originalOs = Platform.OS;
  const originalVersion = Platform.Version;

  beforeEach(() => {
    jest.clearAllMocks();
    useVoicePlayback.setState({
      activeUrl: null,
      playing: false,
      positionMs: 0,
      durationMs: 0,
    });
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOs, configurable: true });
    Object.defineProperty(Platform, 'Version', { value: originalVersion, configurable: true });
    jest.restoreAllMocks();
  });

  it('requests RECORD_AUDIO before starting the recorder on Android', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    Object.defineProperty(Platform, 'Version', { value: 30, configurable: true });
    const request = jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
    const startRecorder = jest.mocked(audioRecorderPlayer.startRecorder);
    const { result, unmount } = renderHook(() => useVoiceRecorder());

    let started = false;
    await act(async () => {
      started = await result.current.start();
    });

    expect(started).toBe(true);
    expect(request).toHaveBeenCalledWith(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      expect.any(Object),
    );
    expect(startRecorder).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.cancel();
    });
    unmount();
  });

  it('starts through the native iOS prompt without calling PermissionsAndroid', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const request = jest.spyOn(PermissionsAndroid, 'request');
    const startRecorder = jest.mocked(audioRecorderPlayer.startRecorder);
    const { result, unmount } = renderHook(() => useVoiceRecorder());

    let started = false;
    await act(async () => {
      started = await result.current.start();
    });

    expect(started).toBe(true);
    expect(request).not.toHaveBeenCalled();
    expect(startRecorder).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.cancel();
    });
    unmount();
  });
});
