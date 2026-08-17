export {};

const mockRoomFindFirst = jest.fn();
const mockRoomFindMany = jest.fn();
const mockFollowFindMany = jest.fn();
const mockClubMemberFindMany = jest.fn();
const mockNotificationFindFirst = jest.fn();
const mockCreateNotification = jest.fn();
const mockGetBlockedIdSet = jest.fn();

const stringKeys = new Map<string, string>();
const setKeys = new Map<string, Set<string>>();

const mockRedisSet = jest.fn(
  async (key: string, value: string, options?: { NX?: boolean }): Promise<'OK' | null> => {
    if (options?.NX && (stringKeys.has(key) || setKeys.has(key))) return null;
    stringKeys.set(key, value);
    return 'OK';
  },
);
const mockRedisSIsMember = jest.fn(async (key: string, value: string): Promise<boolean> => {
  return setKeys.get(key)?.has(value) ?? false;
});
const mockRedisEval = jest.fn(
  async (_script: string, options: { keys: string[]; arguments: string[] }): Promise<number> => {
    const key = options.keys[0];
    const token = options.arguments[0];
    if (key && token && stringKeys.get(key) === token) {
      stringKeys.delete(key);
      return 1;
    }
    return 0;
  },
);
const mockRedisMulti = jest.fn(() => {
  const operations: Array<() => void> = [];
  const chain = {
    sAdd(key: string, value: string) {
      operations.push(() => {
        const members = setKeys.get(key) ?? new Set<string>();
        members.add(value);
        setKeys.set(key, members);
      });
      return chain;
    },
    expire(_key: string, _ttl: number) {
      return chain;
    },
    async exec() {
      operations.forEach(operation => operation());
      return [];
    },
  };
  return chain;
});

jest.mock('../src/config/database', () => ({
  prisma: {
    room: {
      findFirst: (...args: unknown[]) => mockRoomFindFirst(...args),
      findMany: (...args: unknown[]) => mockRoomFindMany(...args),
    },
    follow: { findMany: (...args: unknown[]) => mockFollowFindMany(...args) },
    clubMember: { findMany: (...args: unknown[]) => mockClubMemberFindMany(...args) },
    notification: { findFirst: (...args: unknown[]) => mockNotificationFindFirst(...args) },
  },
}));
jest.mock('../src/config/redis', () => ({
  redis: {
    set: (...args: unknown[]) => mockRedisSet(...(args as Parameters<typeof mockRedisSet>)),
    sIsMember: (...args: unknown[]) =>
      mockRedisSIsMember(...(args as Parameters<typeof mockRedisSIsMember>)),
    eval: (...args: unknown[]) => mockRedisEval(...(args as Parameters<typeof mockRedisEval>)),
    multi: () => mockRedisMulti(),
  },
}));
jest.mock('../src/config/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));
jest.mock('../src/modules/notifications/notifications.service', () => ({
  notificationsService: {
    create: (...args: unknown[]) => mockCreateNotification(...args),
  },
}));
jest.mock('../src/modules/social/blocks', () => ({
  getBlockedIdSet: (...args: unknown[]) => mockGetBlockedIdSet(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fanoutOne, _internals } =
  require('../src/extensions/queues/followFanout') as typeof import('../src/extensions/queues/followFanout');

const liveRoom = {
  id: 'room-1',
  hostId: 'host-1',
  clubId: null,
  title: 'Reliable room',
  roomType: 'OPEN',
  isLive: true,
  endedAt: null,
  isPrivate: false,
  host: { id: 'host-1', username: 'host', displayName: 'Host' },
};

describe('ROOM_STARTED recipient fan-out', () => {
  beforeEach(() => {
    stringKeys.clear();
    setKeys.clear();
    mockRoomFindFirst.mockResolvedValue(liveRoom);
    mockRoomFindMany.mockResolvedValue([]);
    mockFollowFindMany.mockResolvedValue([]);
    mockClubMemberFindMany.mockResolvedValue([]);
    mockNotificationFindFirst.mockResolvedValue(null);
    mockCreateNotification.mockResolvedValue({ id: 'notification-1' });
    mockGetBlockedIdSet.mockResolvedValue(new Set<string>());
  });

  it('retries only the failed recipient after a partial failure', async () => {
    const createdAt = new Date('2026-08-10T12:00:00.000Z');
    mockFollowFindMany.mockResolvedValue([
      { id: 'follow-a', followerId: 'user-a', createdAt },
      { id: 'follow-b', followerId: 'user-b', createdAt },
    ]);
    let failedOnce = false;
    mockCreateNotification.mockImplementation(async (input: { userId: string }) => {
      if (input.userId === 'user-b' && !failedOnce) {
        failedOnce = true;
        throw new Error('transient notification write failure');
      }
      return { id: `notification-${input.userId}` };
    });

    await expect(fanoutOne(liveRoom.id)).rejects.toThrow(
      'ROOM_STARTED fan-out incomplete for 1 recipient',
    );
    await expect(fanoutOne(liveRoom.id)).resolves.toBe(1);

    const deliveredUserIds = mockCreateNotification.mock.calls.map(
      call => (call[0] as { userId: string }).userId,
    );
    expect(deliveredUserIds.filter(userId => userId === 'user-a')).toHaveLength(1);
    expect(deliveredUserIds.filter(userId => userId === 'user-b')).toHaveLength(2);
    expect(setKeys.get(`ext:fanout:v2:notified:${liveRoom.id}`)).toEqual(
      new Set(['user-a', 'user-b']),
    );
  });

  it('repairs a completion marker from an already-persisted notification', async () => {
    mockFollowFindMany.mockResolvedValue([
      {
        id: 'follow-recovered',
        followerId: 'user-recovered',
        createdAt: new Date('2026-08-10T12:00:00.000Z'),
      },
    ]);
    mockNotificationFindFirst.mockResolvedValue({ id: 'already-persisted' });

    await expect(fanoutOne(liveRoom.id)).resolves.toBe(0);

    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(setKeys.get(`ext:fanout:v2:notified:${liveRoom.id}`)).toEqual(
      new Set(['user-recovered']),
    );
  });

  it('paginates more than 5000 followers and club members with bounded concurrency', async () => {
    const followerIds = Array.from(
      { length: 5_001 },
      (_, index) => `follower-${String(index).padStart(5, '0')}`,
    );
    const clubMemberIds = Array.from(
      { length: 5_001 },
      (_, index) => `member-${String(index).padStart(5, '0')}`,
    );
    const createdAt = new Date('2026-08-10T12:00:00.000Z');
    let followOffset = 0;
    let clubOffset = 0;
    mockRoomFindFirst.mockResolvedValue({ ...liveRoom, clubId: 'club-1' });
    mockFollowFindMany.mockImplementation(async () => {
      const ids = followerIds.slice(followOffset, followOffset + _internals.PAGE_SIZE);
      followOffset += ids.length;
      return ids.map((followerId, index) => ({
        id: `follow-${String(followOffset - ids.length + index).padStart(5, '0')}`,
        followerId,
        createdAt,
      }));
    });
    mockClubMemberFindMany.mockImplementation(async () => {
      const ids = clubMemberIds.slice(clubOffset, clubOffset + _internals.PAGE_SIZE);
      clubOffset += ids.length;
      return ids.map(userId => ({ userId }));
    });

    let active = 0;
    let maxActive = 0;
    mockCreateNotification.mockImplementation(async (input: { userId: string }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return { id: `notification-${input.userId}` };
    });

    await expect(fanoutOne(liveRoom.id)).resolves.toBe(10_002);

    expect(mockFollowFindMany).toHaveBeenCalledTimes(21);
    expect(mockClubMemberFindMany).toHaveBeenCalledTimes(21);
    expect(mockCreateNotification).toHaveBeenCalledTimes(10_002);
    expect(maxActive).toBe(_internals.FANOUT_CONCURRENCY);
    expect(
      (mockFollowFindMany.mock.calls[1]?.[0] as { where?: { OR?: unknown[] } }).where?.OR,
    ).toHaveLength(2);
    expect(
      (
        mockClubMemberFindMany.mock.calls[1]?.[0] as {
          where?: { userId?: { gt?: string } };
        }
      ).where?.userId?.gt,
    ).toBe('member-00249');
  });
});
