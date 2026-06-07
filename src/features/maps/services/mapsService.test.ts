import { apiClient } from '../../../shared/services/api/apiClient';
import { mapsService } from './mapsService';

jest.mock('../../../shared/services/api/apiClient', () => ({
  apiClient: { get: jest.fn() },
}));

const mockGet = apiClient.get as jest.Mock;

const row = (over: Record<string, unknown> = {}) => ({
  id: 'a',
  username: 'alice',
  displayName: 'Alice',
  avatarUrl: null,
  latitude: 48.85,
  longitude: 2.35,
  lastSeenAt: new Date().toISOString(),
  currentRoomId: null,
  currentRoom: null,
  ...over,
});

describe('mapsService.nearbyOnMap', () => {
  beforeEach(() => mockGet.mockReset());

  it('M1 calls GET /maps/users with no query when radius is omitted', async () => {
    mockGet.mockResolvedValueOnce({ data: { data: [] } });
    await mapsService.nearbyOnMap();
    expect(mockGet).toHaveBeenCalledWith('/maps/users');
  });

  it('M2 appends ?radiusKm when a positive radius is passed', async () => {
    mockGet.mockResolvedValueOnce({ data: { data: [] } });
    await mapsService.nearbyOnMap(10);
    expect(mockGet).toHaveBeenCalledWith('/maps/users?radiusKm=10');
  });

  it('M3 drops rows with null coordinates', async () => {
    mockGet.mockResolvedValueOnce({
      data: { data: [row(), row({ id: 'b', latitude: null, longitude: null })] },
    });
    const res = await mapsService.nearbyOnMap(25);
    expect(res.map(r => r.id)).toEqual(['a']);
  });

  it('M4 maps a live current room onto liveRoomId/liveRoomTitle', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        data: [
          row({ currentRoomId: 'r1', currentRoom: { id: 'r1', title: 'Tech Talk', isLive: true } }),
        ],
      },
    });
    const [u] = await mapsService.nearbyOnMap(25);
    expect(u).toMatchObject({ liveRoomId: 'r1', liveRoomTitle: 'Tech Talk' });
  });

  it('M5 ignores a non-live current room (no live badge)', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        data: [
          row({
            currentRoomId: 'r1',
            currentRoom: { id: 'r1', title: 'Tech Talk', isLive: false },
          }),
        ],
      },
    });
    const [u] = await mapsService.nearbyOnMap(25);
    expect(u?.liveRoomId).toBeNull();
  });
});
