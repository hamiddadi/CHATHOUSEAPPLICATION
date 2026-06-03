import { Queue } from 'bullmq';
import { bullConnection } from '../queues/connection';

/**
 * GDPR data-purge queue (single source of truth).
 *
 * This module owns the queue NAME and the lazy queue singleton. The worker
 * (`gdpr-purge.worker.ts`) imports both from here so the producer and the
 * consumer can never drift onto different queue names. Mirrors the style of
 * the existing `src/queues/*` modules (lazy singleton + bullConnection()).
 *
 * The queue runs a single recurring "purge" job that the worker schedules
 * idempotently on boot. There is no per-request enqueue API: deletions are
 * driven entirely by the daily cron.
 */
export const GDPR_PURGE_QUEUE_NAME = 'gdpr-purge';

/**
 * The repeatable job name. Kept distinct from the queue name so the worker can
 * clear stale repeatables of exactly this name across redeploys without
 * touching unrelated jobs.
 */
export const GDPR_PURGE_JOB_NAME = 'purge';

let queue: Queue | null = null;

/**
 * Lazy singleton accessor for the GDPR purge queue. Each call to
 * `bullConnection()` returns a fresh IORedis client (maxRetriesPerRequest:null),
 * so the queue does not share a blocking connection with the worker.
 */
export const getGdprPurgeQueue = (): Queue => {
  if (!queue) {
    queue = new Queue(GDPR_PURGE_QUEUE_NAME, { connection: bullConnection() });
  }
  return queue;
};

/**
 * Close + drop the cached queue singleton. Called from the worker's shutdown
 * path so the whole module tears down from one place.
 */
export const closeGdprPurgeQueue = async (): Promise<void> => {
  if (queue) {
    await queue.close();
    queue = null;
  }
};
