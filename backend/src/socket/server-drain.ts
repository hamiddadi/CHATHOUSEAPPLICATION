let serverDraining = false;

/** Mark the process as intentionally draining before Socket.IO is closed. */
export const beginSocketServerDrain = (): void => {
  serverDraining = true;
};

export const isSocketServerDraining = (): boolean => serverDraining;

/**
 * Namespace disconnects express an explicit client/server decision and are
 * applied immediately. Transport failures are involuntary and receive the
 * same bounded reconnect grace as a process restart; unknown future transport
 * reasons default to preservation, with the database reconciler as cleanup.
 */
export const shouldPreserveParticipationForReconnect = (reason: string): boolean => {
  if (reason === 'client namespace disconnect' || reason === 'server namespace disconnect') {
    return false;
  }
  if (reason === 'server shutting down') return serverDraining;
  return true;
};

/** Test-only reset; a production process exits after entering drain mode. */
export const resetSocketServerDrainForTests = (): void => {
  serverDraining = false;
};
