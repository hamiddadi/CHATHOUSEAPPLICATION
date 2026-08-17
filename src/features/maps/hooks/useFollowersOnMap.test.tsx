import { renderHook, waitFor } from '@testing-library/react-native';
import type { FollowerOnMap } from '../../../shared/types/domain';
import { mapsService } from '../services/mapsService';
import { getSocket } from '../../../shared/services/realtime/socketClient';
import { useFollowersOnMap } from './useFollowersOnMap';

jest.mock('../../../config/env', () => ({
  env: { REALTIME_ENABLED: false },
}));

jest.mock('../services/mapsService', () => ({
  mapsService: { followersOnMap: jest.fn() },
  toMapUser: jest.fn(),
}));

jest.mock('../../../shared/services/realtime/socketClient', () => ({
  getSocket: jest.fn(),
  disconnectSocket: jest.fn(),
}));

describe('useFollowersOnMap without realtime', () => {
  it('uses the real REST roster and never seeds fictitious users', async () => {
    const roster: FollowerOnMap[] = [
      {
        id: 'real-user-1',
        username: 'real_user',
        displayName: 'Real User',
        avatarUrl: null,
        location: {
          latitude: 14.7,
          longitude: -17.4,
          updatedAt: '2026-08-10T12:00:00.000Z',
        },
        presence: 'online',
        liveRoomId: null,
        liveRoomTitle: null,
        lastSeenMinutesAgo: 0,
      },
    ];
    jest.mocked(mapsService.followersOnMap).mockResolvedValue(roster);

    const { result } = renderHook(() => useFollowersOnMap());

    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current).toEqual(roster));
    expect(getSocket).not.toHaveBeenCalled();
  });
});
