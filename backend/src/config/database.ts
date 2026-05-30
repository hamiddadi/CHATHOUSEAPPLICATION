import { PrismaClient } from '@prisma/client';
import { env } from './env';
import { logger } from './logger';

// Queries slower than this (in dev) are logged as a warning to surface N+1s
// and missing indexes early.
const SLOW_QUERY_THRESHOLD_MS = 200;

/**
 * Singleton Prisma client. Log levels surface query slowness in dev and errors
 * everywhere. Connection pooling is handled by the driver; use PgBouncer in
 * front of Postgres for scale-out.
 */
export const prisma = new PrismaClient({
  log:
    env.NODE_ENV === 'development'
      ? [{ emit: 'event', level: 'query' }, 'error', 'warn']
      : ['error', 'warn'],
});

if (env.NODE_ENV === 'development') {
  // Prisma's $on('query', ...) typing is intentionally loose — events are
  // emitted only when the client was built with `log: [{ emit: 'event', ... }]`.
  (
    prisma as unknown as {
      $on: (evt: 'query', cb: (e: { duration: number; query: string }) => void) => void;
    }
  ).$on('query', e => {
    if (e.duration > SLOW_QUERY_THRESHOLD_MS) {
      logger.warn(`slow query ${e.duration}ms`, { query: e.query });
    }
  });
}

export const disconnectDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
};
