import { Queue, Worker, type Job } from 'bullmq';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { mediaService } from '../modules/media/media.service';
import { bullConnection } from './connection';

const QUEUE_NAME = 'media-cleanup';
const JOB_NAME = 'purge-abandoned-media';
const STARTUP_ROLLBACK_TIMEOUT_MS = 5_000;

export interface MediaCleanupJobData {
  requestedAt?: string;
}

let queue: Queue<MediaCleanupJobData> | null = null;
let worker: Worker<MediaCleanupJobData> | null = null;
let workerStartup: Promise<Worker<MediaCleanupJobData>> | null = null;

export const getMediaCleanupQueue = (): Queue<MediaCleanupJobData> => {
  if (!queue) {
    queue = new Queue<MediaCleanupJobData>(QUEUE_NAME, { connection: bullConnection() });
  }
  return queue;
};

const processMediaCleanup = async (_job: Job<MediaCleanupJobData>): Promise<void> => {
  const result = await mediaService.purgeAbandonedMedia();
  if (result.deleted > 0) {
    logger.info('media-cleanup: abandoned media objects removed', { count: result.deleted });
  }
  // Individual storage failures are isolated so the bounded batch can make
  // progress, then surfaced to BullMQ so its retry policy revisits them.
  if (result.failed > 0) {
    throw new Error(`Failed to remove ${result.failed} abandoned voice object(s)`);
  }
};

const closeMediaCleanupResources = async (options?: {
  forceWorker?: boolean;
  timeoutMs?: number;
}): Promise<void> => {
  // Clear the published singletons before awaiting I/O. A failed close must
  // never leave a dead Worker/Queue instance looking healthy to the next boot
  // or retry.
  const activeWorker = worker;
  const activeQueue = queue;
  worker = null;
  queue = null;

  const closeAll = Promise.allSettled([
    ...(activeWorker
      ? [Promise.resolve().then(() => activeWorker.close(options?.forceWorker ?? false))]
      : []),
    ...(activeQueue ? [Promise.resolve().then(() => activeQueue.close())] : []),
  ]);
  let timeout: NodeJS.Timeout | undefined;
  const closeResults = options?.timeoutMs
    ? await Promise.race([
        closeAll,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Timed out closing media-cleanup resources')),
            options.timeoutMs,
          );
          timeout.unref();
        }),
      ]).finally(() => {
        if (timeout) clearTimeout(timeout);
      })
    : await closeAll;
  const closeErrors = closeResults
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason);
  if (closeErrors.length > 0) {
    throw new AggregateError(closeErrors, 'Failed to close media-cleanup resources');
  }
};

export const startMediaCleanupWorker = async (): Promise<Worker<MediaCleanupJobData>> => {
  if (workerStartup) return workerStartup;
  if (worker) return worker;

  workerStartup = (async () => {
    try {
      const newWorker = new Worker<MediaCleanupJobData>(QUEUE_NAME, processMediaCleanup, {
        connection: bullConnection(),
      });
      worker = newWorker;
      newWorker.on('failed', (job, err) => {
        logger.error('media-cleanup job failed', { jobId: job?.id, err: err.message });
      });

      const cleanupQueue = getMediaCleanupQueue();
      for (const repeatable of await cleanupQueue.getRepeatableJobs()) {
        if (repeatable.name === JOB_NAME) {
          await cleanupQueue.removeRepeatableByKey(repeatable.key);
        }
      }
      await cleanupQueue.add(
        JOB_NAME,
        {},
        {
          repeat: { pattern: env.VOICE_MEDIA_CLEANUP_CRON },
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: true,
          removeOnFail: { age: 24 * 60 * 60 },
        },
      );
      logger.info('media-cleanup worker registered', { cron: env.VOICE_MEDIA_CLEANUP_CRON });
      return newWorker;
    } catch (err) {
      try {
        await closeMediaCleanupResources({
          forceWorker: true,
          timeoutMs: STARTUP_ROLLBACK_TIMEOUT_MS,
        });
      } catch (cleanupErr) {
        logger.error('media-cleanup startup rollback failed', {
          reason: cleanupErr instanceof Error ? cleanupErr.message : 'unknown cleanup failure',
        });
      }
      throw err;
    } finally {
      workerStartup = null;
    }
  })();
  return workerStartup;
};

export const shutdownMediaCleanup = async (): Promise<void> => {
  await closeMediaCleanupResources();
};

export const _internals = { processMediaCleanup };
