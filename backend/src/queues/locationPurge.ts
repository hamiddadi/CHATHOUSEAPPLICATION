import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { prisma } from '../config/database';

const QUEUE_NAME = 'location-purge';

const bullConnection = (): ConnectionOptions =>
  new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

let queue: Queue | null = null;
let worker: Worker | null = null;

export const getLocationPurgeQueue = (): Queue => {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: bullConnection() });
  }
  return queue;
};

export const startLocationPurgeWorker = async (): Promise<void> => {
  if (worker) return;

  worker = new Worker(
    QUEUE_NAME,
    async () => {
      // Purge location for users inactive for more than 30 days (GDPR compliance)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const res = await prisma.user.updateMany({
        where: {
          lastSeenAt: { lt: thirtyDaysAgo },
          latitude: { not: null },
        },
        data: {
          latitude: null,
          longitude: null,
        },
      });
      if (res.count > 0) {
        logger.info(`location-purge: removed location data for ${res.count} inactive users`);
      }
    },
    { connection: bullConnection() },
  );

  worker.on('failed', (job, err) => {
    logger.error('location-purge job failed', { jobId: job?.id, err: err.message });
  });

  // Schedule the recurring job (runs every day at 3 AM). First clear any
  // existing 'purge' repeatable so a changed cron pattern / jobId between
  // versions can't leave orphaned repeatable jobs that double-fire.
  const q = getLocationPurgeQueue();
  for (const r of await q.getRepeatableJobs()) {
    if (r.name === 'purge') await q.removeRepeatableByKey(r.key);
  }
  await q.add(
    'purge',
    {},
    {
      repeat: { pattern: '0 3 * * *' },
    },
  );
};

export const shutdownLocationPurge = async (): Promise<void> => {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
};
