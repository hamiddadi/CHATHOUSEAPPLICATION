import { type ConnectionOptions } from 'bullmq';
import { env } from '../config/env';

/**
 * Shared BullMQ connection factory.
 *
 * BullMQ requires `maxRetriesPerRequest: null` for the blocking commands used
 * by Worker/QueueEvents. We keep this connection distinct from the app's
 * node-redis client (different driver, different semantics).
 *
 * Return connection options, not a pre-created IORedis instance. BullMQ then
 * owns the client lifecycle and closes it with Queue/Worker.close(); passing a
 * client instance marks it as shared and leaks it unless every caller also
 * tracks and quits that external instance.
 */
export const bullConnection = (): ConnectionOptions => ({
  url: env.REDIS_URL,
  maxRetriesPerRequest: null,
});
