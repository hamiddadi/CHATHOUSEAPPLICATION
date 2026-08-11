import { apiClient } from '../../../shared/services/api/apiClient';
import { profileService } from './profileService';

const user = {
  id: 'user-1',
  username: 'alice',
  displayName: 'Alice',
  avatarUrl: null,
  bio: null,
};

describe('profileService follow-list pagination', () => {
  afterEach(() => jest.restoreAllMocks());

  it('passes through the opaque cursor and exposes hasMore to the hook', async () => {
    const get = jest.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        success: true,
        data: { data: [user], nextCursor: 'v1.next', hasMore: true },
      },
    });

    const page = await profileService.followers('target-1', 'v1.current');

    expect(get).toHaveBeenCalledWith('/follow/target-1/followers', {
      params: { cursor: 'v1.current' },
    });
    expect(page).toMatchObject({
      items: [{ id: 'user-1' }],
      nextCursor: 'v1.next',
      hasMore: true,
    });
  });

  it('infers hasMore from nextCursor for an older backend response', async () => {
    jest.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        success: true,
        data: { data: [user], nextCursor: '2026-08-10T12:00:00.000Z' },
      },
    });

    await expect(profileService.following('target-1')).resolves.toMatchObject({
      nextCursor: '2026-08-10T12:00:00.000Z',
      hasMore: true,
    });
  });
});
