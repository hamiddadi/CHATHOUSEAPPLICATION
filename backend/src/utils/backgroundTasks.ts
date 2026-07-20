export type BackgroundTaskErrorHandler = (error: unknown) => void;

const pendingTasks = new Set<Promise<void>>();

const reportSafely = (handler: BackgroundTaskErrorHandler, error: unknown): void => {
  try {
    handler(error);
  } catch {
    // Error reporting must never turn an already handled background failure
    // into an unhandled rejection of its own.
  }
};

/**
 * Registers a best-effort task so graceful shutdown and tests can drain it.
 * The returned promise always resolves: failures are routed through onError.
 */
export const trackBackgroundTask = (
  task: Promise<unknown>,
  onError: BackgroundTaskErrorHandler,
): Promise<void> => {
  const handled = task.then(
    () => undefined,
    error => reportSafely(onError, error),
  );
  pendingTasks.add(handled);
  void handled.then(() => {
    pendingTasks.delete(handled);
  });
  return handled;
};

/**
 * Starts a task without adding request latency in production. Tests await the
 * real work so fixture teardown cannot race pending Prisma/Redis operations.
 */
export const scheduleBackgroundTask = (
  task: Promise<unknown>,
  onError: BackgroundTaskErrorHandler,
): Promise<void> => {
  const handled = trackBackgroundTask(task, onError);
  return process.env.NODE_ENV === 'test' ? handled : Promise.resolve();
};

export const drainBackgroundTasks = async (): Promise<void> => {
  while (pendingTasks.size > 0) {
    await Promise.allSettled([...pendingTasks]);
  }
};
