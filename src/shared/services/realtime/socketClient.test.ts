/**
 * socketClient — audit QA 2026-07-02 (TRANSVERSAL / socket):
 * - onReconnect() fires its subscribers on every RE-connection of the current
 *   socket, never on a first connect (fresh instances start over).
 * - connect_error auth detection honours the structured `err.data.code` and
 *   the UNAUTHORIZED / TOKEN_REVOKED message codes used by the backend's
 *   socketAuth middleware, while ignoring plain network errors.
 */
import { getSocket, disconnectSocket, onReconnect } from './socketClient';

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
  return {
    connected: false,
    on: jest.fn((event: string, cb: Handler) => push(event, cb)),
    connect: jest.fn(),
    disconnect: jest.fn(),
    removeAllListeners: jest.fn(),
    emit: jest.fn(),
    timeout: jest.fn(),
    io: { on: jest.fn(), removeAllListeners: jest.fn() },
    fire: (event: string, ...args: unknown[]) => {
      (handlers.get(event) ?? []).forEach(cb => cb(...args));
    },
  };
};

// `mock` prefix → allowed inside the hoisted jest.mock factory above. The
// factory only closes over it (never dereferences at hoist time), so the
// late `let` initialisation here is safe.
let mockSocket = makeFakeSocket();

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

describe('socketClient', () => {
  beforeEach(() => {
    disconnectSocket(); // reset the module singleton from the previous test
    jest.clearAllMocks();
    mockSocket = makeFakeSocket();
  });

  describe('onReconnect', () => {
    it('fires on re-connections only, never on the first connect', async () => {
      const handler = jest.fn();
      const unsubscribe = onReconnect(handler);

      await getSocket();
      mockSocket.fire('connect');
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

      await getSocket();
      mockSocket.fire('connect');
      disconnectSocket();

      mockSocket = makeFakeSocket();
      await getSocket();
      mockSocket.fire('connect');
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

      await getSocket();
      mockSocket.fire('connect');
      mockSocket.fire('connect');

      expect(bad).toHaveBeenCalledTimes(1);
      expect(good).toHaveBeenCalledTimes(1);

      unsubBad();
      unsubGood();
    });
  });

  describe('connect_error auth detection', () => {
    it('refreshes auth when the error carries a structured data.code', async () => {
      mockGet.mockResolvedValue({ data: {} });
      await getSocket();

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
      await getSocket();

      mockSocket.fire('connect_error', new Error('TOKEN_REVOKED'));
      await flush();

      expect(mockGet).toHaveBeenCalledWith('/users/me');
    });

    it('still matches the legacy "auth" message sniff', async () => {
      mockGet.mockResolvedValue({ data: {} });
      await getSocket();

      mockSocket.fire('connect_error', new Error('UNAUTHORIZED'));
      await flush();

      expect(mockGet).toHaveBeenCalledWith('/users/me');
    });

    it('does not refresh on a plain network connect_error', async () => {
      await getSocket();

      mockSocket.fire('connect_error', new Error('websocket error'));
      await flush();

      expect(mockGet).not.toHaveBeenCalled();
      expect(mockSocket.connect).not.toHaveBeenCalled();
    });
  });
});
