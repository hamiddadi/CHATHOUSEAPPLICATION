import { isAppError } from './errorHandler';

/**
 * Only mutations with an end-to-end idempotency guarantee may opt into this
 * policy. A first retry is useful for transport timeouts/5xx responses; client
 * and authorization errors are deterministic and must surface immediately.
 */
export const retryTransientMutation = (failureCount: number, error: unknown): boolean =>
  failureCount < 1 &&
  isAppError(error) &&
  (error.kind === 'network' || error.kind === 'timeout' || error.kind === 'server');

/**
 * Execute one immediate transport retry. Callers must keep their payload and
 * Idempotency-Key unchanged inside `operation`, so a lost response can be
 * replayed without creating a second resource.
 */
export const retryIdempotentMutationOnce = async <T>(operation: () => Promise<T>): Promise<T> => {
  const run = async (failureCount: number): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      if (!retryTransientMutation(failureCount, error)) throw error;
      return run(failureCount + 1);
    }
  };
  return run(0);
};
