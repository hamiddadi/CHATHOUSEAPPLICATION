import { createClient, type RedisClientType } from 'redis';
import { env } from './env';
import { logger } from './logger';

/**
 * Shared Redis client. Used for:
 *  - JWT blacklist (access-token revocation)
 *  - Cache (rooms list, etc.)
 *  - Socket.IO redis-adapter pub/sub (phase 3)
 * Clients that need pub/sub must `duplicate()` this instance; a single
 * connection cannot both publish and subscribe.
 */
export const redis: RedisClientType = createClient({ url: env.REDIS_URL });

redis.on('error', err => logger.error('redis error', { err }));
redis.on('reconnecting', () => logger.warn('redis reconnecting'));

let connected = false;

export const connectRedis = async (): Promise<void> => {
  if (connected) return;
  await redis.connect();
  connected = true;
};

export const disconnectRedis = async (): Promise<void> => {
  if (!connected) return;
  await redis.quit();
  connected = false;
};
