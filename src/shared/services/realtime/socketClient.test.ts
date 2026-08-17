/**
 * socketClient — audit QA 2026-07-02 (TRANSVERSAL / socket):
 * - onReconnect() fires its subscribers on every RE-connection of the current
 *   socket, never on a first connect (fresh instances start over).
 * - connect_error auth detection honours the structured `err.data.code` and
 *   the UNAUTHORIZED / TOKEN_REVOKED message codes used by the backend's
 *   socketAuth middleware, while ignoring plain network errors.
 */
import { io } from 'socket.io-client';
import { getSocket, disconnectSocket, onReconnect } from './socketClient';
import { useSocketStore } from './socketStore';

jest.mock('../../../config/env', () => ({
  env: {
    API_BASE_URL: 'http://localhost:4000/api',
    WS_BASE_URL: 'ws://localhost:4000',
    REALTIME_ENABLED: true,
    ENV: 'development',
  },
  isDev: true,
  isProd: false,
}));

const mockGet = jest.fn();
jest.mock('../api/apiClient', () => ({
  apiClient: { get: (...args: unknown[]) => mockGet(...args) },
}));

jest.mock('../../../features/auth/services/tokenStorage', () => ({
  tokenStorage: { get: jest.fn().mockResolvedValue({ accessToken: 'tok' }) },
}));

jest.mock('socket.io-client', () => ({
  io: jest.fn(() => mockSocket),
}));

type Handler = (...args: unknown[]) => void;

interface FakeSocket {
  connected: boolean;
  on: jest.Mock;
  off: jest.Mock;
  connect: jest.Mock;
  disconnect: jest.Mock;
  removeAllListeners: jest.Mock;
  emit: jest.Mock;
  timeout: jest.Mock;
  io: { on: jest.Mock; removeAllListeners: jest.Mock };
  fire: (event: string, ...args: unknown[]) => void;
}

const makeFakeSocket = (): FakeSocket => {
  const handlers = new Map<string, Handler[]>();
  const push = (event: string, cb: Handler): void => {
    handlers.set(event, [...(handlers.get(event) ?? []), cb]);
  };
  const fake: FakeSocket = {
    connected: false,
    on: jest.fn((event: string, cb: Handler) => push(event, cb)),
    off: jest.fn((event: string, cb: Handler) => {
      handlers.set(
        event,
        (handlers.get(event) ?? []).filter(handler => handler !== cb),
      );
    }),
    connect: jest.fn(),
    disconnect: jest.fn(() => {
      fake.connected = false;
    }),
    removeAllListeners: jest.fn(() => handlers.clear()),
    emit: jest.fn(),
    timeout: jest.fn(),
    io: { on: jest.fn(), removeAllListeners: jest.fn() },
    fire: (event: string, ...args: unknown[]) => {
      if (event === 'connect') fake.connected = true;
      if (event === 'disconnect' || event === 'connect_error') fake.connected = false;
      (handlers.get(event) ?? []).forEach(cb => cb(...args));
    },
  };
  return fake;
};

// `mock` prefix → allowed inside the hoisted jest.mock factory above. The
// factory only closes over it (never dereferences at hoist time), so the
// late `let` initialisation here is safe.
let mockSocket = makeFakeSocket();

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));
const connectCurrentSocket = async (): Promise<FakeSocket> => {
  const pending = getSocket();
  await flush();
  mockSocket.fire('connect');
  await expect(pending).resolves.toBe(mockSocket);
  return mockSocket;
};

describe('socketClient', () => {
  beforeEach(() => {
    disconnectSocket(); // reset the module singleton from the previous test
    jest.clearAllMocks();
    mockSocket = makeFakeSocket();
  });

  describe('initial connection contract', () => {
    it('does not resolve until the authenticated Socket.IO handshake connects', async () => {
      let resolved = false;
      const pending = getSocket().then(result => {
        resolved = true;
        return result;
      });

      await flush();
      expect(resolved).toBe(false);
      expect(mockSocket.connect).toHaveBeenCalledTimes(1);

      mockSocket.fire('connect');
      await expect(pending).resolves.toBe(mockSocket);
    });

    it('shares one pending handshake between concurrent callers', async () => {
      const first = getSocket();
      const second = getSocket();
      await flush();

      expect(mockSocket.connect).toHaveBeenCalledTimes(1);
      mockSocket.fire('connect');
      await expect(Promise.all([first, second])).resolves.toEqual([mockSocket, mockSocket]);
    });

    it('binds one-shot consumers when an offline first attempt later reconnects', async () => {
      const onNotification = jest.fn();
      let resolved = false;
      const firstMount = getSocket().then(s => {
        resolved = true;
        s?.on('notification:new', onNotification);
        return s;
      });

      await flush();
      mockSocket.fire('connect_error', new Error('websocket error'));
      await flush();

      expect(resolved).toBe(false);
      expect(mockSocket.disconnect).not.toHaveBeenCalled();
      expect(io).toHaveBeenCalledTimes(1);

      mockSocket.fire('connect');
      await expect(firstMount).resolves.toBe(mockSocket);

      mockSocket.fire('notification:new');
      expect(onNotification).toHaveBeenCalledTimes(1);
      expect(io).toHaveBeenCalledTimes(1);
    });

    it('keeps the default subscription wait alive through a long offline period', async () => {
      jest.useFakeTimers();
      try {
        let resolved = false;
        const pending = getSocket().then(result => {
          resolved = true;
          return result;
        });

        mockSocket.fire('connect_error', new Error('websocket error'));
        jest.advanceTimersByTime(60_000);
        await Promise.resolve();

        expect(resolved).toBe(false);
        expect(mockSocket.disconnect).not.toHaveBeenCalled();

        mockSocket.fire('connect');
        await expect(pending).resolves.toBe(mockSocket);
      } finally {
        jest.useRealTimers();
      }
    });

    it('times out without returning or destroying the unauthenticated singleton', async () => {
      jest.useFakeTimers();
      try {
        const first = getSocket(100);
        expect(mockSocket.connect).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(100);
        await expect(first).resolves.toBeNull();
        expect(mockSocket.disconnect).not.toHaveBeenCalled();
        expect(mockSocket.removeAllListeners).not.toHaveBeenCalled();

        const retry = getSocket(100);
        expect(io).toHaveBeenCalledTimes(1);
        mockSocket.fire('connect');
        await expect(retry).resolves.toBe(mockSocket);
      } finally {
        jest.useRealTimers();
      }
    });

    it('cancels a pending wait on logout without a stale status transition', async () => {
      const pending = getSocket(1_000);
      await flush();

      disconnectSocket();

      await expect(pending).resolves.toBeNull();
      expect(mockSocket.disconnect).toHaveBeenCalledTimes(1);
      expect(useSocketStore.getState().status).toBe('idle');
    });
  });

  describe('onReconnect', () => {
    it('fires on re-connections only, never on the first connect', async () => {
      const handler = jest.fn();
      const unsubscribe = onReconnect(handler);

      await connectCurrentSocket();
      expect(handler).not.toHaveBeenCalled();

      mockSocket.fire('disconnect', 'transport close');
      mockSocket.fire('connect');
      expect(handler).toHaveBeenCalledTimes(1);

      mockSocket.fire('connect');
      expect(handler).toHaveBeenCalledTimes(2);

      unsubscribe();
      mockSocket.fire('connect');
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('treats the first connect of a fresh socket after teardown as a first connect', async () => {
      const handler = jest.fn();
      const unsubscribe = onReconnect(handler);

      await connectCurrentSocket();
      disconnectSocket();

      mockSocket = makeFakeSocket();
      await connectCurrentSocket();
      expect(handler).not.toHaveBeenCalled();

      unsubscribe();
    });

    it('keeps notifying the remaining subscribers when one throws', async () => {
      const bad = jest.fn(() => {
        throw new Error('boom');
      });
      const good = jest.fn();
      const unsubBad = onReconnect(bad);
      const unsubGood = onReconnect(good);

      await connectCurrentSocket();
      mockSocket.fire('connect');

      expect(bad).toHaveBeenCalledTimes(1);
      expect(good).toHaveBeenCalledTimes(1);

      unsubBad();
      unsubGood();
    });
  });

  describe('connect_error auth detection', () => {
    it('lets a replacement login refresh while the logged-out socket probe is still pending', async () => {
      let resolveOldRefresh: (() => void) | undefined;
      mockGet
        .mockImplementationOnce(
          () =>
            new Promise<void>(resolve => {
              resolveOldRefresh = resolve;
            }),
        )
        .mockResolvedValueOnce({ data: {} });

      const oldPending = getSocket(1_000);
      await flush();
      const oldSocket = mockSocket;
      oldSocket.fire('connect_error', new Error('UNAUTHORIZED'));
      await flush();
      expect(mockGet).toHaveBeenCalledTimes(1);

      disconnectSocket();
      await expect(oldPending).resolves.toBeNull();

      mockSocket = makeFakeSocket();
      const replacementPending = getSocket(1_000);
      await flush();
      mockSocket.fire('connect_error', new Error('UNAUTHORIZED'));
      await flush();

      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(mockSocket.connect).toHaveBeenCalledTimes(2);
      mockSocket.fire('connect');
      await expect(replacementPending).resolves.toBe(mockSocket);

      expect(resolveOldRefresh).toBeDefined();
      resolveOldRefresh?.();
      await flush();
      expect(oldSocket.connect).toHaveBeenCalledTimes(1);
    });

    it('refreshes auth when the error carries a structured data.code', async () => {
      mockGet.mockResolvedValue({ data: {} });
      await connectCurrentSocket();
      mockSocket.connect.mockClear();

      const err = Object.assign(new Error('handshake failed'), {
        data: { code: 'UNAUTHORIZED' },
      });
      mockSocket.fire('connect_error', err);
      await flush();

      expect(mockGet).toHaveBeenCalledWith('/users/me');
      // after a successful refresh the still-current socket is reconnected
      expect(mockSocket.connect).toHaveBeenCalled();
    });

    it('refreshes auth on a TOKEN_REVOKED message (backend socketAuth code)', async () => {
      mockGet.mockResolvedValue({ data: {} });
      await connectCurrentSocket();
      mockSocket.connect.mockClear();

      mockSocket.fire('connect_error', new Error('TOKEN_REVOKED'));
      await flush();

      expect(mockGet).toHaveBeenCalledWith('/users/me');
    });

    it('still matches the legacy "auth" message sniff', async () => {
      mockGet.mockResolvedValue({ data: {} });
      await connectCurrentSocket();
      mockSocket.connect.mockClear();

      mockSocket.fire('connect_error', new Error('UNAUTHORIZED'));
      await flush();

      expect(mockGet).toHaveBeenCalledWith('/users/me');
    });

    it('does not refresh on a plain network connect_error', async () => {
      await connectCurrentSocket();
      mockSocket.connect.mockClear();

      mockSocket.fire('connect_error', new Error('websocket error'));
      await flush();

      expect(mockGet).not.toHaveBeenCalled();
      expect(mockSocket.connect).not.toHaveBeenCalled();
    });
  });
});
