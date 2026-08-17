const mockGet = jest.fn();

jest.mock('../../../shared/services/api/apiClient', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

import { presenceApi } from './presenceApi';

describe('presenceApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches a privacy-filtered peer presence and encodes the route id', async () => {
    const payload = {
      visible: true,
      isOnline: true,
      lastSeenAt: '2026-07-30T12:00:00.000Z',
    };
    mockGet.mockResolvedValue({ data: payload });

    await expect(presenceApi.peer('peer/with space')).resolves.toEqual(payload);
    expect(mockGet).toHaveBeenCalledWith('/ext/presence/peer%2Fwith%20space');
  });
});
