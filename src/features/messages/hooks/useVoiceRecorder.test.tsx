import { act, renderHook } from '@testing-library/react-native';
import { permissions as mediaPermissions } from '@livekit/react-native-webrtc';
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
    jest.mocked(mediaPermissions.query).mockResolvedValue(mediaPermissions.RESULT.GRANTED);
    jest.mocked(mediaPermissions.request).mockResolvedValue(true);
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

  it('starts after the native iOS permission check without calling PermissionsAndroid', async () => {
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

  it('stops a native iOS recording that starts after the hook unmounts', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    let resolveStart!: (uri: string) => void;
    const nativeStart = new Promise<string>(resolve => {
      resolveStart = resolve;
    });
    const startRecorder = jest
      .mocked(audioRecorderPlayer.startRecorder)
      .mockReturnValueOnce(nativeStart);
    const stopRecorder = jest.mocked(audioRecorderPlayer.stopRecorder);
    const { result, unmount } = renderHook(() => useVoiceRecorder());

    let pending!: Promise<boolean>;
    act(() => {
      pending = result.current.start();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(startRecorder).toHaveBeenCalledTimes(1);

    unmount();
    resolveStart('/tmp/late-ios-recording.m4a');

    await expect(pending).resolves.toBe(false);
    expect(stopRecorder).toHaveBeenCalledTimes(1);
  });
});
