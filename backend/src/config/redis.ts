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
export const redis: RedisClientType = createClient({
  url: env.REDIS_URL,
  socket: {
    // A lost test dependency must fail the CI job promptly. Retrying forever
    // turned a short Docker outage into a multi-hour Jest run and kept a
    // reconnect timer/socket alive after the suites had completed. Production
    // keeps node-redis' jittered reconnect strategy.
    reconnectStrategy: env.NODE_ENV === 'test' ? false : undefined,
    connectTimeout: 5_000,
  },
});

redis.on('error', err => logger.error('redis error', { err }));
redis.on('reconnecting', () => logger.warn('redis reconnecting'));

let connectPromise: Promise<void> | null = null;

export const connectRedis = async (): Promise<void> => {
  if (redis.isReady) return;

  // Keep connection ownership explicit: importing a router/service must never
  // open a network socket. This also prevents unit and OpenAPI tests that only
  // build the Express app from leaking an otherwise-unused Redis connection.
  if (!connectPromise) {
    if (redis.isOpen) {
      throw new Error('Redis client is open but not ready');
    }
    connectPromise = redis
      .connect()
      .then(() => undefined)
      .finally(() => {
        connectPromise = null;
      });
  }

  await connectPromise;
};

export const disconnectRedis = async (): Promise<void> => {
  if (!redis.isOpen) return;

  // Redis only stores revocation/cache/coordination data here; every command
  // that matters is awaited before teardown. `destroy()` is deterministic even
  // while the server is unavailable or reconnecting, whereas deprecated
  // `quit()` can queue forever waiting for a reply from a failed dependency.
  redis.destroy();
};
