// Socket.IO does not await promises returned by disconnect listeners. Track
// them explicitly so transport shutdown can finish all presence/room writes
// before Redis, queues, or the database are closed.
const pendingDisconnectCleanups = new Set<Promise<unknown>>();
const keyedDisconnectQueues = new Map<string, Promise<void>>();

export const trackSocketDisconnectCleanup = (task: Promise<unknown>): void => {
  pendingDisconnectCleanups.add(task);
  void task.finally(() => pendingDisconnectCleanups.delete(task)).catch(() => undefined);
};

// Disconnect callbacks for the same account/room can arrive together when an
// auth revocation drops several devices. Serializing each key keeps the
// last-device check and the idempotent DB leave in a deterministic order.
export const enqueueSocketDisconnectCleanup = (key: string, task: () => Promise<void>): void => {
  const previous = keyedDisconnectQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  keyedDisconnectQueues.set(key, current);
  trackSocketDisconnectCleanup(current);
  void current
    .finally(() => {
      if (keyedDisconnectQueues.get(key) === current) keyedDisconnectQueues.delete(key);
    })
    .catch(() => undefined);
};

export const drainSocketDisconnectCleanups = async (): Promise<void> => {
  while (pendingDisconnectCleanups.size > 0) {
    await Promise.allSettled([...pendingDisconnectCleanups]);
  }
};
