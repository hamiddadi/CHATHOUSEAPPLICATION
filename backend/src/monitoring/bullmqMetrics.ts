import type { JobType, Queue } from 'bullmq';
import { logger } from '../config/logger';
import { bullmqJobsGauge } from './metrics';

export const BULLMQ_JOB_STATES = [
  'waiting',
  'active',
  'completed',
  'failed',
  'delayed',
] as const satisfies readonly JobType[];

export type BullMqQueueMetricsSource = Pick<Queue, 'name' | 'getJobCounts'>;

const DEFAULT_COLLECTION_INTERVAL_MS = 15_000;

let collectionTimer: NodeJS.Timeout | null = null;
let collectionInFlight: Promise<void> | null = null;
let activeSources: BullMqQueueMetricsSource[] = [];
let started = false;

/**
 * Read the global BullMQ counts from each configured queue and publish them to
 * Prometheus. A failure in one queue must not suppress fresh samples for the
 * others, nor prevent the API from starting.
 */
export const collectBullMqJobMetrics = async (
  sources: readonly BullMqQueueMetricsSource[],
): Promise<void> => {
  const results = await Promise.allSettled(
    sources.map(async source => {
      const counts = await source.getJobCounts(...BULLMQ_JOB_STATES);
      for (const state of BULLMQ_JOB_STATES) {
        bullmqJobsGauge.set({ queue: source.name, state }, counts[state] ?? 0);
      }
    }),
  );

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.warn('bullmq metrics collection failed', {
        queue: sources[index]?.name ?? 'unknown',
        reason: result.reason instanceof Error ? result.reason.message : 'unknown error',
      });
    }
  });
};

const runCollection = (): Promise<void> => {
  if (collectionInFlight) return collectionInFlight;
  collectionInFlight = collectBullMqJobMetrics(activeSources).finally(() => {
    collectionInFlight = null;
  });
  return collectionInFlight;
};

/** Start one non-overlapping, process-scoped BullMQ metrics collector. */
export const startBullMqMetricsCollector = (
  sources: readonly BullMqQueueMetricsSource[],
  intervalMs = DEFAULT_COLLECTION_INTERVAL_MS,
): void => {
  if (started) return;
  started = true;

  // A queue name is the stable Prometheus label. Avoid polling or exporting a
  // duplicate source if a caller accidentally supplies the same queue twice.
  activeSources = [...new Map(sources.map(source => [source.name, source])).values()];
  // Sampling is deliberately non-blocking: an IORedis reconnect loop must not
  // hold API startup. Errors are isolated and logged by the collector.
  void runCollection();
  collectionTimer = setInterval(() => {
    void runCollection();
  }, intervalMs);
  collectionTimer.unref();
};

/** Stop future polling before the owned BullMQ Queue connections are closed. */
export const stopBullMqMetricsCollector = (): void => {
  started = false;
  activeSources = [];
  if (collectionTimer) {
    clearInterval(collectionTimer);
    collectionTimer = null;
  }
};
