import { prisma } from '../src/config/database';
import { logger } from '../src/config/logger';
import { redis } from '../src/config/redis';
import * as livekitRevocation from '../src/modules/rooms/livekit-revocation.outbox';
import * as realtime from '../src/socket/realtime';
import { adminService } from '../src/modules/admin/admin.service';

const actor = {
  id: 'admin-1',
  appRole: 'SUPER_ADMIN',
  deletedAt: null,
  suspendedUntil: null,
} as const;

const target = {
  id: 'user-1',
  appRole: 'USER',
  deletedAt: null,
} as const;

const updatedTarget = {
  ...target,
  username: 'user-1',
  displayName: null,
  email: null,
  phoneNumber: null,
  avatarUrl: null,
  isOnline: false,
  suspendedUntil: new Date('9999-12-31T23:59:59Z'),
  suspensionReason: 'policy',
  followerCount: 0,
  followingCount: 0,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  lastSeenAt: null,
};

const context = { ip: null, userAgent: null };

describe('admin post-commit account revocation', () => {
  afterEach(() => jest.restoreAllMocks());

  const mockPreflight = (): void => {
    jest
      .spyOn(prisma.user, 'findUnique')
      .mockResolvedValueOnce(actor as never)
      .mockResolvedValueOnce(target as never);
  };

  it('disconnects a suspended user before cache I/O and continues when cache and wake fail', async () => {
    mockPreflight();
    const transaction = jest.spyOn(prisma, '$transaction').mockResolvedValueOnce({
      updated: updatedTarget,
      revocations: {
        participants: [{ roomId: 'room-1', transitionId: 'transition-1' }],
        rooms: [],
      },
    } as never);
    const disconnect = jest.spyOn(realtime, 'disconnectUserSockets').mockImplementation(() => {});
    const cache = jest.spyOn(redis, 'setEx').mockRejectedValueOnce(new Error('redis down'));
    const wake = jest
      .spyOn(livekitRevocation, 'wakeLivekitRevocation')
      .mockRejectedValueOnce(new Error('provider wake down'));
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);

    await expect(
      adminService.suspend('admin-1', 'user-1', { reason: 'policy' }, context),
    ).resolves.toMatchObject({ id: 'user-1' });

    expect(disconnect).toHaveBeenCalledWith('user-1', 'account_suspended');
    expect(wake).toHaveBeenCalledWith('transition-1');
    expect(transaction.mock.invocationCallOrder[0]).toBeLessThan(
      disconnect.mock.invocationCallOrder[0]!,
    );
    expect(disconnect.mock.invocationCallOrder[0]).toBeLessThan(cache.mock.invocationCallOrder[0]!);
    expect(warn).toHaveBeenCalledWith(
      'admin.suspend: suspension cache update failed',
      expect.objectContaining({ targetUserId: 'user-1' }),
    );
    expect(warn).toHaveBeenCalledWith(
      'admin.suspend: LiveKit revocation wake failed',
      expect.objectContaining({ roomId: 'room-1' }),
    );
  });

  it('disconnects a deleted user before cache I/O and treats cache failure as best-effort', async () => {
    mockPreflight();
    const transaction = jest.spyOn(prisma, '$transaction').mockResolvedValueOnce({
      participants: [],
      rooms: [],
    } as never);
    const disconnect = jest.spyOn(realtime, 'disconnectUserSockets').mockImplementation(() => {});
    const cache = jest.spyOn(redis, 'setEx').mockRejectedValueOnce(new Error('redis down'));
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);

    await expect(adminService.deleteUser('admin-1', 'user-1', context)).resolves.toEqual({
      deleted: true,
    });

    expect(disconnect).toHaveBeenCalledWith('user-1', 'account_deleted');
    expect(transaction.mock.invocationCallOrder[0]).toBeLessThan(
      disconnect.mock.invocationCallOrder[0]!,
    );
    expect(disconnect.mock.invocationCallOrder[0]).toBeLessThan(cache.mock.invocationCallOrder[0]!);
    expect(warn).toHaveBeenCalledWith(
      'admin.deleteUser: suspension cache update failed',
      expect.objectContaining({ targetUserId: 'user-1' }),
    );
  });
});
