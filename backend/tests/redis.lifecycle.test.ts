import { connectRedis, disconnectRedis, redis } from '../src/config/redis';

afterEach(async () => {
  await disconnectRedis();
});

describe('shared Redis lifecycle', () => {
  it('does not open a network connection as an import side effect', () => {
    expect(redis.isOpen).toBe(false);
    expect(redis.isReady).toBe(false);
  });

  it('deduplicates concurrent connects and closes deterministically', async () => {
    await Promise.all([connectRedis(), connectRedis(), connectRedis()]);

    expect(redis.isOpen).toBe(true);
    expect(redis.isReady).toBe(true);

    await disconnectRedis();

    expect(redis.isOpen).toBe(false);
    expect(redis.isReady).toBe(false);
  });

  it('allows repeated disconnects', async () => {
    await connectRedis();
    await disconnectRedis();

    await expect(disconnectRedis()).resolves.toBeUndefined();
  });
});
