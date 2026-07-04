import { io, type Socket } from 'socket.io-client';
import { env } from '../../../config/env';
import { apiClient } from '../api/apiClient';
import { tokenStorage } from '../../../features/auth/services/tokenStorage';
import { useSocketStore } from './socketStore';

let socket: Socket | null = null;
let connecting: Promise<Socket | null> | null = null;
// Guards against a tight refresh→reconnect→auth-error loop when the refresh
// token itself is dead (no valid session to recover).
let refreshingAuth = false;

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
  if (refreshingAuth) return;
  refreshingAuth = true;
  try {
    await apiClient.get('/users/me');
  } catch {
    // Refresh failed (e.g. dead refresh token) — leave the socket disconnected
    // rather than hammering the server. signOut flow will tear it down.
    return;
  } finally {
    refreshingAuth = false;
  }
  // Only reconnect the still-current singleton; a logout may have nulled it.
  if (socket === s && !s.connected) s.connect();
};

const wireLifecycle = (s: Socket): void => {
  const store = useSocketStore.getState();
  store.set('connecting');
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
 * Returns a connected Socket.IO client, or `null` if realtime is disabled
 * (`env.REALTIME_ENABLED === false`) — callers then fall back to mock data.
 * Idempotent: concurrent calls share the same connection promise.
 */
export const getSocket = async (): Promise<Socket | null> => {
  if (!env.REALTIME_ENABLED) return null;
  // Reuse the singleton even while it's mid-reconnect: returning it (and nudging
  // .connect(), which is a no-op if already connecting) prevents a second io()
  // instance — the old one would otherwise leak with its lifecycle handlers
  // still attached, duplicating every server event.
  if (socket) {
    if (!socket.connected) socket.connect();
    return socket;
  }
  if (connecting) return connecting;

  connecting = (async () => {
    const s = io(env.WS_BASE_URL, {
      transports: ['websocket'],
      // Callback form: socket.io re-invokes this on EVERY (re)connection, so
      // the freshest access token from tokenStorage is used each time. An
      // object literal here would freeze the token for the socket's lifetime
      // and break reconnection after the 15-min access token expires.
      auth: cb => {
        void tokenStorage.get().then(session => cb({ token: session?.accessToken ?? '' }));
      },
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    });
    wireLifecycle(s);
    socket = s;
    return s;
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
};

/**
 * Measure socket round-trip time in milliseconds via the server's `rtt:ping`
 * ack. Returns `null` when realtime is disabled or the ack times out (so a
 * latency badge can render "—" rather than a misleading number). Uses
 * socket.io's `.timeout()` so a dropped connection rejects instead of hanging.
 */
export const measureRtt = async (timeoutMs = 5_000): Promise<number | null> => {
  const s = await getSocket();
  if (!s) return null;
  const start = Date.now();
  return new Promise<number | null>(resolve => {
    s.timeout(timeoutMs).emit('rtt:ping', { t: start }, (err: Error | null) => {
      resolve(err ? null : Date.now() - start);
    });
  });
};

export const disconnectSocket = (): void => {
  if (socket) {
    // Remove the lifecycle listeners wired in wireLifecycle (both on the
    // Socket and on its Manager `socket.io`) before dropping the reference,
    // so a login → logout → login cycle doesn't accumulate orphaned handlers
    // on Manager instances kept alive by in-flight reconnection timers.
    socket.removeAllListeners();
    socket.io.removeAllListeners();
    socket.disconnect();
  }
  socket = null;
  connecting = null; // never hand back a stale connection promise after teardown
  useSocketStore.getState().set('idle');
};
