import { logger } from '../config/logger';
import {
  redisMemoryMaxBytesGauge,
  redisMemoryMetricsAvailableGauge,
  redisMemoryUsageRatioGauge,
  redisMemoryUsedBytesGauge,
} from './metrics';

export interface RedisMemorySource {
  info(section: 'memory'): Promise<string>;
}

export interface RedisReadinessSource extends RedisMemorySource {
  ping(): Promise<string>;
}

export interface RedisMemorySnapshot {
  usedMemoryBytes: number;
  maxMemoryBytes: number;
  usageRatio: number;
  maxMemoryPolicy: string;
}

const DEFAULT_COLLECTION_INTERVAL_MS = 15_000;

/**
 * Keep a small safety margin before Redis starts rejecting BullMQ, revocation
 * and rate-limit writes under `noeviction`. Warning/critical alerts fire much
 * earlier (80/90%); readiness is only withdrawn near actual exhaustion.
 */
export const REDIS_READINESS_MAX_MEMORY_RATIO = 0.98;

let collectionTimer: NodeJS.Timeout | null = null;
let collectionInFlight: Promise<void> | null = null;
let activeSource: RedisMemorySource | null = null;

const parseNonNegativeNumber = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

/** Parse only the stable fields needed from Redis `INFO memory`. */
export const parseRedisMemoryInfo = (raw: string): RedisMemorySnapshot | null => {
  const fields = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    fields.set(line.slice(0, separator), line.slice(separator + 1).trim());
  }

  const usedMemoryBytes = parseNonNegativeNumber(fields.get('used_memory'));
  const maxMemoryBytes = parseNonNegativeNumber(fields.get('maxmemory'));
  const maxMemoryPolicy = fields.get('maxmemory_policy')?.trim().toLowerCase();
  if (usedMemoryBytes === null || maxMemoryBytes === null || !maxMemoryPolicy) return null;

  return {
    usedMemoryBytes,
    maxMemoryBytes,
    usageRatio: maxMemoryBytes > 0 ? usedMemoryBytes / maxMemoryBytes : 0,
    maxMemoryPolicy,
  };
};

export const readRedisMemorySnapshot = async (
  source: RedisMemorySource,
): Promise<RedisMemorySnapshot> => {
  const snapshot = parseRedisMemoryInfo(await source.info('memory'));
  if (!snapshot) throw new Error('Redis INFO memory response is incomplete');
  return snapshot;
};

export const isRedisMemoryReady = (
  snapshot: RedisMemorySnapshot,
  maxRatio = REDIS_READINESS_MAX_MEMORY_RATIO,
): boolean => {
  // With no Redis-level ceiling there is no imminent noeviction OOM state to
  // infer from INFO. Production Compose always configures maxmemory; this
  // branch keeps local/test and externally-managed unlimited Redis compatible.
  if (snapshot.maxMemoryBytes === 0) return true;
  return snapshot.maxMemoryPolicy === 'noeviction' && snapshot.usageRatio < maxRatio;
};

/**
 * Non-destructive readiness check. It deliberately performs no SET/DEL probe:
 * a process crash between those commands could leave a key behind, while INFO
 * already exposes both the active policy and the memory headroom relevant to
 * `noeviction` write failures.
 */
export const checkRedisReadiness = async (source: RedisReadinessSource): Promise<boolean> => {
  try {
    const [pong, snapshot] = await Promise.all([source.ping(), readRedisMemorySnapshot(source)]);
    return pong === 'PONG' && isRedisMemoryReady(snapshot);
  } catch {
    return false;
  }
};

/** Refresh Prometheus gauges without allowing telemetry failure to crash API startup. */
export const collectRedisMemoryMetrics = async (source: RedisMemorySource): Promise<void> => {
  try {
    const snapshot = await readRedisMemorySnapshot(source);
    redisMemoryUsedBytesGauge.set(snapshot.usedMemoryBytes);
    redisMemoryMaxBytesGauge.set(snapshot.maxMemoryBytes);
    redisMemoryUsageRatioGauge.set(snapshot.usageRatio);
    redisMemoryMetricsAvailableGauge.set(1);
  } catch (err) {
    redisMemoryMetricsAvailableGauge.set(0);
    logger.warn('redis memory metrics collection failed', {
      reason: err instanceof Error ? err.message : 'unknown error',
    });
  }
};

const runCollection = (): Promise<void> => {
  if (collectionInFlight) return collectionInFlight;
  if (!activeSource) return Promise.resolve();
  collectionInFlight = collectRedisMemoryMetrics(activeSource).finally(() => {
    collectionInFlight = null;
  });
  return collectionInFlight;
};

export const startRedisMemoryMetricsCollector = (
  source: RedisMemorySource,
  intervalMs = DEFAULT_COLLECTION_INTERVAL_MS,
): void => {
  if (collectionTimer) return;
  activeSource = source;
  void runCollection();
  collectionTimer = setInterval(() => {
    void runCollection();
  }, intervalMs);
  collectionTimer.unref();
};

export const stopRedisMemoryMetricsCollector = (): void => {
  activeSource = null;
  if (collectionTimer) {
    clearInterval(collectionTimer);
    collectionTimer = null;
  }
};
