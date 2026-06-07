import { renderHook, waitFor, act } from '@testing-library/react-native';
import { mapsService } from '../services/mapsService';
import { getSocket } from '../../../shared/services/realtime/socketClient';
import type { FollowerOnMap } from '../../../shared/types/domain';
import { useNearbyOnMap } from './useNearbyOnMap';

jest.mock('../../../config/env', () => ({ env: { REALTIME_ENABLED: true } }));
jest.mock('../services/mapsService', () => ({ mapsService: { nearbyOnMap: jest.fn() } }));
jest.mock('../../../shared/services/realtime/socketClient', () => ({ getSocket: jest.fn() }));

const mockNearby = mapsService.nearbyOnMap as jest.Mock;
const mockGetSocket = getSocket as jest.Mock;

type Handler = (p: unknown) => void;
const makeSocket = () => {
  const handlers: Record<string, Handler[]> = {};
  return {
    on: jest.fn((e: string, cb: Handler) => {
      (handlers[e] ||= []).push(cb);
    }),
    off: jest.fn((e: string, cb: Handler) => {
      handlers[e] = (handlers[e] || []).filter(h => h !== cb);
    }),
    emit: (e: string, payload: unknown) => (handlers[e] || []).forEach(h => h(payload)),
  };
};

const person = (over: Partial<FollowerOnMap> = {}): FollowerOnMap => ({
  id: 'a',
  username: 'alice',
  displayName: 'Alice',
  avatarUrl: null,
  location: { latitude: 1, longitude: 2, updatedAt: 'x' },
  presence: 'online',
  liveRoomId: null,
  liveRoomTitle: null,
  lastSeenMinutesAgo: 5,
  ...over,
});

describe('useNearbyOnMap', () => {
  beforeEach(() => {
    mockNearby.mockReset();
    mockGetSocket.mockReset();
  });

  it('H-U1 seeds the roster from the REST snapshot', async () => {
    mockNearby.mockResolvedValue([person()]);
    mockGetSocket.mockResolvedValue(null);
    const { result } = renderHook(() => useNearbyOnMap());
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].id).toBe('a');
  });

  it('H-U2 relocates a known user on maps:user-moved', async () => {
    mockNearby.mockResolvedValue([person()]);
    const socket = makeSocket();
    mockGetSocket.mockResolvedValue(socket);
    const { result } = renderHook(() => useNearbyOnMap());
    await waitFor(() => expect(result.current).toHaveLength(1));
    await waitFor(() =>
      expect(socket.on).toHaveBeenCalledWith('maps:user-moved', expect.any(Function)),
    );
    act(() => socket.emit('maps:user-moved', { userId: 'a', latitude: 9, longitude: 8 }));
    expect(result.current[0].location).toMatchObject({ latitude: 9, longitude: 8 });
    expect(result.current[0].lastSeenMinutesAgo).toBe(0);
  });

  it('H-U3 removes a user on maps:user-offline', async () => {
    mockNearby.mockResolvedValue([person()]);
    const socket = makeSocket();
    mockGetSocket.mockResolvedValue(socket);
    const { result } = renderHook(() => useNearbyOnMap());
    await waitFor(() => expect(result.current).toHaveLength(1));
    await waitFor(() =>
      expect(socket.on).toHaveBeenCalledWith('maps:user-offline', expect.any(Function)),
    );
    act(() => socket.emit('maps:user-offline', { userId: 'a' }));
    expect(result.current).toHaveLength(0);
  });

  it('H-U4 ignores moves for unknown users (no phantom pins)', async () => {
    mockNearby.mockResolvedValue([person()]);
    const socket = makeSocket();
    mockGetSocket.mockResolvedValue(socket);
    const { result } = renderHook(() => useNearbyOnMap());
    await waitFor(() => expect(result.current).toHaveLength(1));
    await waitFor(() =>
      expect(socket.on).toHaveBeenCalledWith('maps:user-moved', expect.any(Function)),
    );
    act(() => socket.emit('maps:user-moved', { userId: 'zzz', latitude: 0, longitude: 0 }));
    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe('a');
  });
});
