import { io, type Socket } from 'socket.io-client';
import { env } from '../../../config/env';
import { apiClient } from '../api/apiClient';
import { tokenStorage } from '../../../features/auth/services/tokenStorage';
import { useSocketStore } from './socketStore';

let socket: Socket | null = null;
let connecting: Promise<Socket | null> | null = null;
let cancelConnectionWait: (() => void) | null = null;

// Guards against a tight refresh→reconnect→auth-error loop when the refresh
// token itself is dead (no valid session to recover).
let authRefresh: { socket: Socket; promise: Promise<void> } | null = null;

// Subscribers notified after every socket RE-connection (never the first
// successful connect of a socket instance): realtime events may have been
// missed during the gap, so subscribers refetch/invalidate their caches.
// Module-level so the registry survives disconnectSocket() teardowns.
const reconnectHandlers = new Set<() => void>();

/**
 * Register a handler invoked after each socket re-connection — auto-reconnect
 * or a manual `.connect()` after an auth refresh; anything but the socket's
 * first successful connect. Returns the unsubscribe function.
 */
export const onReconnect = (handler: () => void): (() => void) => {
  reconnectHandlers.add(handler);
  return () => {
    reconnectHandlers.delete(handler);
  };
};

// Auth-rejection detector for `connect_error`. Prefers the structured
// `err.data.code` when the server attaches one; falls back to sniffing the
// message (the backend's socketAuth rejects with plain Errors whose message
// IS the code: UNAUTHORIZED / TOKEN_REVOKED).
const AUTH_ERROR_PATTERN = /auth|token_revoked/i;
const isAuthConnectError = (err: Error & { data?: { code?: unknown } }): boolean => {
  const code = err.data?.code;
  if (typeof code === 'string' && AUTH_ERROR_PATTERN.test(code)) return true;
  return AUTH_ERROR_PATTERN.test(String(err.message));
};

/**
 * On an auth-related `connect_error`, the (re)connection used a stale access
 * token. Trigger the REST interceptor's silent refresh by issuing one
 * authenticated probe (`GET /users/me`): a 401 there runs refresh→retry and
 * writes the fresh session to `tokenStorage`. The dynamic `auth` callback then
 * picks up the new token on the next `connect()`.
 */
const refreshAuthAndReconnect = async (s: Socket): Promise<void> => {
  if (authRefresh?.socket === s) return authRefresh.promise;

  const promise = (async (): Promise<void> => {
    try {
      await apiClient.get('/users/me');
    } catch {
      // Refresh failed (e.g. dead refresh token) — leave the socket disconnected
      // rather than hammering the server. signOut flow will tear it down.
      return;
    }
    // Only reconnect the still-current singleton; a logout may have nulled it.
    if (socket === s && !s.connected) s.connect();
  })();
  authRefresh = { socket: s, promise };

  try {
    await promise;
  } finally {
    // A late completion from a logged-out socket must not clear a newer
    // socket's in-flight refresh guard.
    if (authRefresh?.promise === promise) authRefresh = null;
  }
};

const wireLifecycle = (s: Socket): void => {
  useSocketStore.getState().set('connecting');
  // Per-socket flag: distinguishes the first successful connect from later
  // RE-connections so onReconnect() subscribers only fire when a gap may have
  // dropped realtime events. A fresh socket after disconnectSocket() starts
  // over (its first connect is not a "re"-connection).
  let connectedBefore = false;
  s.on('connect', () => {
    useSocketStore.getState().set('connected');
    if (connectedBefore) {
      reconnectHandlers.forEach(handler => {
        try {
          handler();
        } catch {
          // A throwing subscriber must not break the connect pipeline or
          // starve the other subscribers.
        }
      });
    }
    connectedBefore = true;
  });
  s.on('disconnect', reason => {
    // reason === 'io client disconnect' → user-initiated, silent.
    if (reason === 'io client disconnect') {
      useSocketStore.getState().set('idle');
    } else {
      useSocketStore.getState().set('disconnected');
    }
  });
  s.on('connect_error', err => {
    useSocketStore.getState().set('disconnected');
    // Auth handshake rejected → refresh the token and reconnect once.
    if (isAuthConnectError(err)) {
      void refreshAuthAndReconnect(s);
    }
  });
  s.io.on('reconnect_attempt', () => useSocketStore.getState().set('reconnecting'));
  s.io.on('reconnect', () => useSocketStore.getState().set('connected'));
  s.io.on('error', () => useSocketStore.getState().set('disconnected'));
};

/**
 * Wait until Socket.IO has completed its authenticated handshake. Creating an
 * `io()` instance is not proof of connectivity: returning that instance early
 * let room code issue `room:join` and request a LiveKit token while the socket
 * was still disconnected.
 *
 * Auth failures remain pending while the REST refresh path obtains a new
 * token. Transient transport failures stay pending too: Socket.IO owns the
 * reconnect backoff, so one-shot hooks can finish binding without a remount.
 * Subscription hooks wait until connectivity returns (or logout cancels the
 * wait), because resolving `null` would leave one-shot listeners permanently
 * unbound. Per-caller timeouts are applied by `getSocket()` without cancelling
 * this shared underlying connection attempt.
 */
const waitForConnection = (s: Socket): Promise<boolean> => {
  if (s.connected) return Promise.resolve(true);

  useSocketStore.getState().set('connecting');
  return new Promise(resolve => {
    let settled = false;

    function finish(connected: boolean): void {
      if (settled) return;
      settled = true;
      s.off('connect', handleConnect);
      if (cancelConnectionWait === cancel) cancelConnectionWait = null;
      resolve(connected);
    }
    function handleConnect(): void {
      finish(true);
    }
    const cancel = (): void => finish(false);
    cancelConnectionWait = cancel;
    s.on('connect', handleConnect);
    s.connect();
  });
};

const withCallerTimeout = (
  attempt: Promise<Socket | null>,
  timeoutMs?: number,
): Promise<Socket | null> => {
  if (timeoutMs === undefined) return attempt;

  return new Promise(resolve => {
    let settled = false;
    const finish = (result: Socket | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), Math.max(0, timeoutMs));
    void attempt.then(finish);
  });
};

/**
 * Returns a connected Socket.IO client, or `null` if realtime is disabled or
 * an explicitly bounded connection attempt fails. By default the promise
 * remains pending across offline periods so one-shot subscription hooks bind
 * as soon as Socket.IO reconnects. Concurrent callers share one attempt and
 * never receive a socket whose authenticated handshake is still pending.
 */
export const getSocket = async (connectionTimeoutMs?: number): Promise<Socket | null> => {
  if (!env.REALTIME_ENABLED) return null;
  if (socket?.connected) return socket;
  if (!connecting) {
    const existingSocket = socket;
    const attempt = (async (): Promise<Socket | null> => {
      const s =
        existingSocket ??
        io(env.WS_BASE_URL, {
          transports: ['websocket'],
          // Install lifecycle + connection waiters before opening the transport,
          // otherwise a fast local handshake can fire before we listen.
          autoConnect: false,
          // Callback form: socket.io re-invokes this on EVERY (re)connection, so
          // the freshest access token from tokenStorage is used each time.
          auth: cb => {
            void tokenStorage.get().then(session => cb({ token: session?.accessToken ?? '' }));
          },
          reconnection: true,
          reconnectionDelay: 1_000,
          reconnectionDelayMax: 10_000,
        });

      if (!existingSocket) {
        wireLifecycle(s);
        socket = s;
      }

      const connected = await waitForConnection(s);
      if (connected && socket === s) return s;

      // A logout may have reset/replaced the singleton while this await was
      // pending, so a stale attempt must not overwrite the idle state.
      if (socket === s && !s.connected) {
        useSocketStore.getState().set('disconnected');
      }
      return null;
    })();
    connecting = attempt;
    void attempt.then(() => {
      if (connecting === attempt) connecting = null;
    });
  }

  return withCallerTimeout(connecting, connectionTimeoutMs);
};

/**
 * Measure socket round-trip time in milliseconds via the server's `rtt:ping`
 * ack. Returns `null` when realtime is disabled or the ack times out (so a
 * latency badge can render "—" rather than a misleading number). Uses
 * socket.io's `.timeout()` so a dropped connection rejects instead of hanging.
 */
export const measureRtt = async (timeoutMs = 5_000): Promise<number | null> => {
  const s = await getSocket(timeoutMs);
  if (!s) return null;
  const start = Date.now();
  return new Promise<number | null>(resolve => {
    s.timeout(timeoutMs).emit('rtt:ping', { t: start }, (err: Error | null) => {
      resolve(err ? null : Date.now() - start);
    });
  });
};

export const disconnectSocket = (): void => {
  cancelConnectionWait?.();
  cancelConnectionWait = null;
  authRefresh = null;
  if (socket) {
    // Remove the lifecycle listeners wired in wireLifecycle (both on the
    // Socket and on its Manager `socket.io`) before dropping the reference,
    // so a login → logout → login cycle doesn't accumulate orphaned handlers.
    socket.removeAllListeners();
    socket.io.removeAllListeners();
    socket.disconnect();
  }
  socket = null;
  connecting = null;
  useSocketStore.getState().set('idle');
};
