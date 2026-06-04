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

// Initiate the connection EAGERLY at import time. Some modules construct a
// Redis-backed store at import (e.g. rate-limit-redis' RedisStore preloads a
// Lua script in its constructor via sendCommand). If `connect()` hasn't been
// called yet, node-redis throws `ClientClosedError: The client is closed`,
// crashing boot before app.ts can call connectRedis(). Calling connect() here
// flips the socket to "open/connecting" synchronously, so those early commands
// queue and flush on ready instead of throwing. connectRedis() awaits this
// same promise (no double connect()).
const connectPromise: Promise<void> = redis
  .connect()
  .then(() => undefined)
  .catch(err => {
    logger.error('redis initial connect failed', { err });
  });

export const connectRedis = async (): Promise<void> => {
  await connectPromise;
};

export const disconnectRedis = async (): Promise<void> => {
  if (!redis.isOpen) return;
  await redis.quit();
};
