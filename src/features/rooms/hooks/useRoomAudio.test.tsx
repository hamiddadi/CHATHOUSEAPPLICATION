import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '../../auth/store/authStore';
import { roomAudioSession } from '../services/roomAudioSession';
import { useRoomAudio } from './useRoomAudio';

jest.mock('../../../config/env', () => ({
  env: { REALTIME_ENABLED: true },
}));

jest.mock('../../auth/store/authStore', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  return {
    useAuthStore: create(() => ({
      status: 'idle',
      user: null,
    })),
  };
});

jest.mock('../services/roomAudioSession', () => {
  const state = {
    roomId: null,
    status: 'idle',
    error: null,
    scores: new Map(),
  };
  return {
    SELF_KEY: '__self__',
    useRoomAudioStore: (selector: (value: typeof state) => unknown) => selector(state),
    roomAudioSession: {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      setMuted: jest.fn().mockResolvedValue(undefined),
      setPeerVolume: jest.fn(),
    },
  };
});

describe('useRoomAudio retry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      status: 'authenticated',
      user: { id: 'viewer-1' },
    } as never);
  });

  it('retries the failed session for the current room without remounting', async () => {
    const { result } = renderHook(() => useRoomAudio({ roomId: 'room-1' }));
    jest.mocked(roomAudioSession.start).mockClear();

    await act(async () => {
      await result.current.retry();
    });

    expect(roomAudioSession.start).toHaveBeenCalledWith('room-1');
  });

  it('does nothing when no room is selected', async () => {
    const { result } = renderHook(() => useRoomAudio({ roomId: null }));

    await act(async () => {
      await result.current.retry();
    });

    expect(roomAudioSession.start).not.toHaveBeenCalled();
  });

  it('waits for cold-start auth hydration, then starts the room once the user appears', async () => {
    useAuthStore.setState({ status: 'idle', user: null } as never);
    renderHook(() => useRoomAudio({ roomId: 'room-cold-start' }));

    expect(roomAudioSession.start).not.toHaveBeenCalled();

    act(() => {
      useAuthStore.setState({
        status: 'authenticated',
        user: { id: 'viewer-cold' },
      } as never);
    });

    await waitFor(() => expect(roomAudioSession.start).toHaveBeenCalledWith('room-cold-start'));
    expect(roomAudioSession.start).toHaveBeenCalledTimes(1);
  });
});
