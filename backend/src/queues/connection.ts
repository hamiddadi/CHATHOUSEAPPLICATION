import { type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';

/**
 * Shared BullMQ connection factory.
 *
 * BullMQ requires `maxRetriesPerRequest: null` for the blocking commands used
 * by Worker/QueueEvents. We keep this connection distinct from the app's
 * node-redis client (different driver, different semantics).
 *
 * Each call returns a fresh IORedis client so that queues and workers do not
 * share a single blocking connection.
 */
export const bullConnection = (): ConnectionOptions =>
  new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
