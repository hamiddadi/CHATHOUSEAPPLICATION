import { apiClient } from '../../../shared/services/api/apiClient';
import { profileService } from './profileService';

const rawUser = (id: string) => ({
  id,
  username: id,
  displayName: `User ${id}`,
  avatarUrl: null,
  bio: null,
  isOnline: false,
  followerCount: 2,
  followingCount: 3,
  createdAt: '2026-08-10T12:00:00.000Z',
});

describe('profileService private follow requests', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps the server pending state when a profile is refetched', async () => {
    jest.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          ...rawUser('private-1'),
          isFollowedByMe: false,
          followRequestedByMe: true,
        },
      },
    });

    await expect(profileService.get('private-1')).resolves.toMatchObject({
      id: 'private-1',
      isFollowedByMe: false,
      followRequestedByMe: true,
    });
  });

  it('preserves the follow response distinction between accepted and requested', async () => {
    const post = jest.spyOn(apiClient, 'post').mockResolvedValue({
      data: { success: true, data: { following: false, requested: true } },
    });

    await expect(profileService.follow('private-1')).resolves.toEqual({
      following: false,
      requested: true,
    });
    expect(post).toHaveBeenCalledWith('/follow/private-1');
  });

  it('loads the composite-cursor inbox and calls both decision endpoints', async () => {
    const get = jest.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        success: true,
        data: { data: [rawUser('requester-1')], nextCursor: 'v1.next', hasMore: true },
      },
    });
    const post = jest
      .spyOn(apiClient, 'post')
      .mockResolvedValueOnce({ data: { success: true, data: { accepted: true } } })
      .mockResolvedValueOnce({ data: { success: true, data: { rejected: true } } });

    await expect(profileService.followRequests('v1.current')).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 'requester-1' })],
      nextCursor: 'v1.next',
      hasMore: true,
    });
    expect(get).toHaveBeenCalledWith('/follow/requests', { params: { cursor: 'v1.current' } });
    await expect(profileService.acceptFollowRequest('requester-1')).resolves.toEqual({
      accepted: true,
    });
    await expect(profileService.rejectFollowRequest('requester-2')).resolves.toEqual({
      rejected: true,
    });
    expect(post).toHaveBeenNthCalledWith(1, '/follow/requester-1/accept');
    expect(post).toHaveBeenNthCalledWith(2, '/follow/requester-2/reject');
  });
});
