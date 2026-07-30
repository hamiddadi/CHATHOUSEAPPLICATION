const findUser = jest.fn();
const findFollow = jest.fn();
const getBlockedIdSet = jest.fn();

jest.mock('../src/config/database', () => ({
  prisma: {
    user: { findFirst: (...args: unknown[]) => findUser(...args) },
    follow: { findFirst: (...args: unknown[]) => findFollow(...args) },
  },
}));

jest.mock('../src/modules/social/blocks', () => ({
  getBlockedIdSet: (...args: unknown[]) => getBlockedIdSet(...args),
}));

import { presenceService } from '../src/extensions/modules/presence/presence.service';

describe('presenceService.forPeer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getBlockedIdSet.mockResolvedValue(new Set<string>());
  });

  it('reveals presence to an accepted follower of a public peer', async () => {
    const lastSeenAt = new Date('2026-07-30T12:00:00.000Z');
    findUser.mockResolvedValue({
      isOnline: true,
      lastSeenAt,
      isPrivateAccount: false,
    });
    findFollow.mockResolvedValueOnce({ followerId: 'viewer' }).mockResolvedValueOnce(null);

    await expect(presenceService.forPeer('viewer', 'peer')).resolves.toEqual({
      visible: true,
      isOnline: true,
      lastSeenAt,
    });
  });

  it('hides a private peer without a reciprocal accepted follow', async () => {
    findUser.mockResolvedValue({
      isOnline: true,
      lastSeenAt: new Date(),
      isPrivateAccount: true,
    });
    findFollow.mockResolvedValueOnce({ followerId: 'viewer' }).mockResolvedValueOnce(null);

    await expect(presenceService.forPeer('viewer', 'peer')).resolves.toEqual({
      visible: false,
      isOnline: false,
      lastSeenAt: null,
    });
  });

  it('returns the same neutral payload for a blocked peer', async () => {
    findUser.mockResolvedValue({
      isOnline: true,
      lastSeenAt: new Date(),
      isPrivateAccount: false,
    });
    findFollow
      .mockResolvedValueOnce({ followerId: 'viewer' })
      .mockResolvedValueOnce({ followerId: 'peer' });
    getBlockedIdSet.mockResolvedValue(new Set(['peer']));

    await expect(presenceService.forPeer('viewer', 'peer')).resolves.toEqual({
      visible: false,
      isOnline: false,
      lastSeenAt: null,
    });
  });
});
