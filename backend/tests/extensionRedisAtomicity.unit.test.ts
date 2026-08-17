jest.mock('../src/config/redis', () => ({
  redis: {
    eval: jest.fn().mockResolvedValue(1),
    del: jest.fn().mockResolvedValue(1),
    lRange: jest.fn().mockResolvedValue([]),
    zRange: jest.fn().mockResolvedValue([]),
  },
}));
jest.mock('../src/config/database', () => ({
  prisma: { room: { findMany: jest.fn().mockResolvedValue([]) } },
}));
jest.mock('../src/modules/rooms/rooms.access', () => ({
  assertRoomMetadataAccess: jest.fn().mockResolvedValue(undefined),
  roomMetadataAccessWhere: jest.fn().mockReturnValue({}),
}));

import { redis } from '../src/config/redis';
import { assertRoomMetadataAccess } from '../src/modules/rooms/rooms.access';
import { recentlyPlayedService } from '../src/extensions/modules/recentlyPlayed/recentlyPlayed.service';
import { searchHistoryService } from '../src/extensions/modules/searchHistory/searchHistory.service';

const mockRedis = jest.mocked(redis);
const mockAssertRoomMetadataAccess = jest.mocked(assertRoomMetadataAccess);

describe('atomic Redis extension writes', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it('records and de-duplicates search history in a single Lua command', async () => {
    await searchHistoryService.record('user-a', '  Mixed Case  ');

    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    const [script, options] = mockRedis.eval.mock.calls[0] ?? [];
    expect(script).toContain("redis.call('LRANGE'");
    expect(script).toContain("redis.call('EXPIRE'");
    expect(options).toEqual({
      keys: ['ext:searchhist:user-a'],
      arguments: ['Mixed Case', 'mixed case', '20', String(30 * 24 * 3600)],
    });
  });

  it('removes search history in one atomic Lua command', async () => {
    await searchHistoryService.removeOne('user-a', 'MiXeD');

    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    const [script, options] = mockRedis.eval.mock.calls[0] ?? [];
    expect(script).toContain("redis.call('DEL'");
    expect(options).toEqual({
      keys: ['ext:searchhist:user-a'],
      arguments: ['mixed', String(30 * 24 * 3600)],
    });
  });

  it('checks room access then touches, trims, and expires recently played atomically', async () => {
    jest.spyOn(Date, 'now').mockReturnValueOnce(123_456);

    await recentlyPlayedService.touch('user-a', 'room-a');

    expect(mockAssertRoomMetadataAccess).toHaveBeenCalledWith('room-a', 'user-a');
    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    const [script, options] = mockRedis.eval.mock.calls[0] ?? [];
    expect(script).toContain("redis.call('ZADD'");
    expect(script).toContain("redis.call('ZREMRANGEBYRANK'");
    expect(options).toEqual({
      keys: ['ext:recent:user-a'],
      arguments: ['123456', 'room-a', '30', String(60 * 24 * 3600)],
    });
  });

  it('bounds Redis list reads to their storage caps', async () => {
    await searchHistoryService.list('user-a', 10_000);
    await recentlyPlayedService.listIds('user-a', 10_000);

    expect(mockRedis.lRange).toHaveBeenCalledWith('ext:searchhist:user-a', 0, 19);
    expect(mockRedis.zRange).toHaveBeenCalledWith('ext:recent:user-a', 0, 29, { REV: true });
  });
});
