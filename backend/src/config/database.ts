import { Prisma, PrismaClient } from '@prisma/client';
import { env } from './env';
import { logger } from './logger';
import { dbQueryDuration } from '../monitoring/metrics';

// Queries slower than this (in dev) are logged as a warning to surface N+1s
// and missing indexes early.
const SLOW_QUERY_THRESHOLD_MS = 200;

/**
 * Singleton Prisma client. Log levels surface query slowness in dev and errors
 * everywhere. Connection pooling is handled by the driver; use PgBouncer in
 * front of Postgres for scale-out.
 */
// Keep the exported client as a plain PrismaClient. Query extensions alter
// its structural type and make it incompatible with Prisma.TransactionClient
// helpers throughout the application.
export const prisma: PrismaClient = new PrismaClient({
  // An event sink does not print SQL. It gives us timings in every environment
  // while the callback below only logs query text in development.
  log: [{ emit: 'event', level: 'query' }, 'error', 'warn'],
});

export const recordDatabaseQueryMetrics = (event: { duration: number; query: string }): void => {
  const operation = /^\s*(select|insert|update|delete|with|begin|commit|rollback)\b/i.exec(
    event.query,
  )?.[1];
  dbQueryDuration.observe(
    { model: 'sql', operation: operation?.toLowerCase() ?? 'other' },
    event.duration / 1_000,
  );

  if (env.NODE_ENV === 'development' && event.duration > SLOW_QUERY_THRESHOLD_MS) {
    logger.warn(`slow query ${event.duration}ms`, { query: event.query });
  }
};

{
  // Prisma's $on('query', ...) typing is intentionally loose — events are
  // emitted only when the client was built with `log: [{ emit: 'event', ... }]`.
  (
    prisma as unknown as {
      $on: (evt: 'query', cb: (e: { duration: number; query: string }) => void) => void;
    }
  ).$on('query', recordDatabaseQueryMetrics);
}

/**
 * A transient write conflict / deadlock that is safe to retry: Postgres aborts
 * one of two transactions caught in a deadlock (SQLSTATE 40P01) or that fail to
 * serialize (40001). Prisma surfaces these as P2034, but a deadlock inside a
 * batch `$transaction([...])` can also arrive as a raw connector error whose
 * message carries the SQLSTATE — so we match both. Anything else (P2002 unique
 * violation, validation, …) is NOT transient and must propagate to the caller's
 * own handling.
 */
const isTransientWriteConflict = (err: unknown): boolean => {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2034') return true;

    const metaCode = typeof err.meta?.['code'] === 'string' ? err.meta['code'] : '';
    const metaError = typeof err.meta?.['error'] === 'string' ? err.meta['error'] : '';
    if (err.code === 'P2010' && /40P01|40001/i.test(metaCode)) return true;
    // Interactive transactions can fail before they start when a short burst
    // exhausts the Prisma pool, or expire while waiting on a row lock. The
    // whole transaction has been rolled back in both cases, so callers using
    // this helper can safely retry from the beginning.
    if (
      err.code === 'P2028' &&
      /unable to start a transaction|transaction.*expired|transaction.*closed/i.test(metaError)
    ) {
      return true;
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /deadlock detected|40P01|40001|could not serialize|write conflict/i.test(msg);
};

/**
 * Run a write that can hit a transient Postgres deadlock / serialization
 * failure, retrying it a few times with a short linear backoff. Used for the
 * follow/unfollow counter transactions where two reciprocal writes (A→B and
 * B→A) touch the same two `User` rows and can deadlock under concurrency.
 * Non-transient errors are rethrown immediately so existing catch blocks (e.g.
 * P2002 idempotency) keep working unchanged.
 */
export const runWriteWithRetry = async <T>(
  fn: () => Promise<T>,
  { attempts = 4, baseDelayMs = 25 }: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> => {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransientWriteConflict(err)) throw err;
      lastErr = err;
      logger.warn('transient write conflict — retrying', { attempt: attempt + 1, attempts });
      await new Promise(resolve => setTimeout(resolve, baseDelayMs * (attempt + 1)));
    }
  }
  throw lastErr;
};

export const disconnectDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
};
