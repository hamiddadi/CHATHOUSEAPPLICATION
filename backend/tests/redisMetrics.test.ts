import {
  checkRedisReadiness,
  collectRedisMemoryMetrics,
  isRedisMemoryReady,
  parseRedisMemoryInfo,
  startRedisMemoryMetricsCollector,
  stopRedisMemoryMetricsCollector,
  type RedisMemorySource,
} from '../src/monitoring/redisMetrics';
import {
  redisMemoryMaxBytesGauge,
  redisMemoryMetricsAvailableGauge,
  redisMemoryUsageRatioGauge,
  redisMemoryUsedBytesGauge,
} from '../src/monitoring/metrics';

const info = (used: number, max: number, policy = 'noeviction'): string =>
  ['# Memory', `used_memory:${used}`, `maxmemory:${max}`, `maxmemory_policy:${policy}`, ''].join(
    '\r\n',
  );

const source = (raw: string | Error): RedisMemorySource => ({
  info: jest.fn().mockImplementation(async () => {
    if (raw instanceof Error) throw raw;
    return raw;
  }),
});

describe('Redis memory telemetry and readiness', () => {
  beforeEach(() => {
    stopRedisMemoryMetricsCollector();
    redisMemoryUsedBytesGauge.reset();
    redisMemoryMaxBytesGauge.reset();
    redisMemoryUsageRatioGauge.reset();
    redisMemoryMetricsAvailableGauge.reset();
  });

  afterEach(() => {
    stopRedisMemoryMetricsCollector();
    jest.useRealTimers();
  });

  it('parses used/max memory, policy and ratio from INFO memory', () => {
    expect(parseRedisMemoryInfo(info(400, 1_000))).toEqual({
      usedMemoryBytes: 400,
      maxMemoryBytes: 1_000,
      usageRatio: 0.4,
      maxMemoryPolicy: 'noeviction',
    });
    expect(parseRedisMemoryInfo('used_memory:not-a-number\r\nmaxmemory:100')).toBeNull();
  });

  it('publishes used/max/ratio gauges and an availability signal', async () => {
    await collectRedisMemoryMetrics(source(info(800, 1_000)));

    await expect(redisMemoryUsedBytesGauge.get()).resolves.toMatchObject({
      values: [expect.objectContaining({ value: 800 })],
    });
    await expect(redisMemoryMaxBytesGauge.get()).resolves.toMatchObject({
      values: [expect.objectContaining({ value: 1_000 })],
    });
    await expect(redisMemoryUsageRatioGauge.get()).resolves.toMatchObject({
      values: [expect.objectContaining({ value: 0.8 })],
    });
    await expect(redisMemoryMetricsAvailableGauge.get()).resolves.toMatchObject({
      values: [expect.objectContaining({ value: 1 })],
    });
  });

  it('marks telemetry unavailable without throwing when INFO fails', async () => {
    await expect(
      collectRedisMemoryMetrics(source(new Error('redis unavailable'))),
    ).resolves.toBeUndefined();
    await expect(redisMemoryMetricsAvailableGauge.get()).resolves.toMatchObject({
      values: [expect.objectContaining({ value: 0 })],
    });
  });

  it('withdraws readiness near capacity or under an eviction policy', async () => {
    const healthy = parseRedisMemoryInfo(info(970, 1_000));
    const saturated = parseRedisMemoryInfo(info(980, 1_000));
    const evicting = parseRedisMemoryInfo(info(100, 1_000, 'allkeys-lru'));
    if (!healthy || !saturated || !evicting) throw new Error('invalid fixture');

    expect(isRedisMemoryReady(healthy)).toBe(true);
    expect(isRedisMemoryReady(saturated)).toBe(false);
    expect(isRedisMemoryReady(evicting)).toBe(false);
    expect(isRedisMemoryReady({ ...saturated, maxMemoryBytes: 0, usageRatio: 0 })).toBe(true);

    await expect(
      checkRedisReadiness({
        ping: jest.fn().mockResolvedValue('PONG'),
        info: jest.fn().mockResolvedValue(info(980, 1_000)),
      }),
    ).resolves.toBe(false);
  });

  it('starts one non-overlapping collector and stops future polling', async () => {
    jest.useFakeTimers();
    const redis = source(info(100, 1_000));

    startRedisMemoryMetricsCollector(redis, 1_000);
    startRedisMemoryMetricsCollector(redis, 1_000);
    expect(redis.info).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1_000);
    expect(redis.info).toHaveBeenCalledTimes(2);

    stopRedisMemoryMetricsCollector();
    await jest.advanceTimersByTimeAsync(2_000);
    expect(redis.info).toHaveBeenCalledTimes(2);
  });
});
