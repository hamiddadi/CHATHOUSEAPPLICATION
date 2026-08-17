import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server, type Socket } from 'socket.io';
import { io as ioClient } from 'socket.io-client';
import {
  attachSocketEventRateLimiter,
  DistributedSocketEventRateLimiter,
  MAX_SOCKET_PAYLOAD_BYTES,
  SocketEventRateLimiter,
  type SocketRateLimitNotice,
} from '../src/socket/socket.rate-limit';

describe('Socket.IO inbound event rate limiter', () => {
  let now: number;

  beforeEach(() => {
    now = 10_000;
  });

  const limiter = (overrides: ConstructorParameters<typeof SocketEventRateLimiter>[0] = {}) =>
    new SocketEventRateLimiter({ now: () => now, ...overrides });

  it('keeps a generous RTC burst and refills it without blocking audio signalling', () => {
    const subject = limiter();
    subject.register('socket-a', 'user-a');

    for (let i = 0; i < 100; i += 1) {
      expect(subject.check('socket-a', 'rtc:consume').allowed).toBe(true);
    }
    const limited = subject.check('socket-a', 'rtc:consume');
    expect(limited).toMatchObject({
      allowed: false,
      category: 'rtc',
      retryAfterMs: 40,
      disconnect: false,
    });

    now += 40;
    expect(subject.check('socket-a', 'rtc:consume').allowed).toBe(true);
  });

  it('caps database-backed presence touches while allowing the normal heartbeat cadence', () => {
    const subject = limiter();
    subject.register('socket-a', 'user-a');

    for (let i = 0; i < 4; i += 1) {
      expect(subject.check('socket-a', 'presence_update').allowed).toBe(true);
    }
    expect(subject.check('socket-a', 'presence_update')).toMatchObject({
      allowed: false,
      category: 'presence',
      retryAfterMs: 10_000,
    });

    now += 10_000;
    expect(subject.check('socket-a', 'presence_update').allowed).toBe(true);
  });

  it('aggregates mutation traffic across all sockets for one user', () => {
    const subject = limiter();
    subject.register('socket-a', 'user-a');
    subject.register('socket-b', 'user-a');
    subject.register('socket-c', 'user-a');

    for (const socketId of ['socket-a', 'socket-b']) {
      for (let i = 0; i < 25; i += 1) {
        expect(subject.check(socketId, 'chat:send').allowed).toBe(true);
      }
    }
    for (let i = 0; i < 10; i += 1) {
      expect(subject.check('socket-c', 'room:mute').allowed).toBe(true);
    }
    expect(subject.check('socket-c', 'room:mute')).toMatchObject({
      allowed: false,
      category: 'mutation',
      retryAfterMs: 100,
    });
  });

  it('enforces a fixed-window account quota through one atomic Redis command', async () => {
    const evalCommand = jest.fn().mockResolvedValue([13, 12_345]);
    const subject = new DistributedSocketEventRateLimiter({ eval: evalCommand }, () => 120_001);

    await expect(subject.check('user-a', 'presence')).resolves.toEqual({
      allowed: false,
      retryAfterMs: 12_345,
    });
    expect(evalCommand).toHaveBeenCalledTimes(1);
    expect(evalCommand.mock.calls[0]?.[1]).toEqual({
      keys: ['socket:quota:presence:user-a:2'],
      arguments: ['60000'],
    });
  });

  it('does not send hot RTC signalling through Redis', async () => {
    const evalCommand = jest.fn();
    const subject = new DistributedSocketEventRateLimiter({ eval: evalCommand });

    await expect(subject.check('user-a', 'rtc')).resolves.toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
    expect(evalCommand).not.toHaveBeenCalled();
  });

  it('preserves the account bucket across reconnects until the retention window expires', () => {
    const subject = limiter({
      perSocket: { mutation: { capacity: 2, refillPerSecond: 1 } },
      perUser: { mutation: { capacity: 2, refillPerSecond: 1 } },
      userStateRetentionMs: 5_000,
    });
    subject.register('socket-a', 'user-a');
    expect(subject.check('socket-a', 'chat:send').allowed).toBe(true);
    expect(subject.check('socket-a', 'chat:send').allowed).toBe(true);
    expect(subject.check('socket-a', 'chat:send').allowed).toBe(false);

    subject.unregister('socket-a');
    subject.register('socket-b', 'user-a');
    expect(subject.check('socket-b', 'chat:send').allowed).toBe(false);

    subject.unregister('socket-b');
    now += 5_000;
    subject.register('socket-c', 'user-a');
    expect(subject.check('socket-c', 'chat:send').allowed).toBe(true);
  });

  it('preserves the abuse counter across rapid reconnects', () => {
    const subject = limiter({
      perSocket: { mutation: { capacity: 1, refillPerSecond: 0.1 } },
      perUser: { mutation: { capacity: 1, refillPerSecond: 0.1 } },
      abuseMaxRejected: 3,
    });
    subject.register('socket-a', 'user-a');
    expect(subject.check('socket-a', 'chat:send').allowed).toBe(true);
    expect(subject.check('socket-a', 'chat:send').disconnect).toBe(false);
    subject.unregister('socket-a');

    subject.register('socket-b', 'user-a');
    expect(subject.check('socket-b', 'chat:send').disconnect).toBe(false);
    subject.unregister('socket-b');

    subject.register('socket-c', 'user-a');
    expect(subject.check('socket-c', 'chat:send').disconnect).toBe(true);
  });

  it('acks limited packets according to their existing contract and coalesces notices', () => {
    const subject = limiter({
      perSocket: { rtc: { capacity: 1, refillPerSecond: 1 } },
      perUser: { rtc: { capacity: 1, refillPerSecond: 1 } },
    });
    let middleware:
      | ((packet: [string, ...unknown[]], next: (err?: Error) => void) => void)
      | undefined;
    const listeners = new Map<string, () => void>();
    const emitted: Array<[string, unknown]> = [];
    const fakeSocket = {
      id: 'socket-a',
      data: { userId: 'user-a' },
      use: jest.fn((fn: typeof middleware) => {
        middleware = fn;
      }),
      on: jest.fn((event: string, fn: () => void) => {
        listeners.set(event, fn);
      }),
      emit: jest.fn((event: string, payload: unknown) => {
        emitted.push([event, payload]);
      }),
      disconnect: jest.fn(),
    } as unknown as Socket;

    attachSocketEventRateLimiter(fakeSocket, subject);
    expect(middleware).toBeDefined();

    const next = jest.fn();
    middleware?.(['rtc:consume', {}, jest.fn()], next);
    expect(next).toHaveBeenCalledTimes(1);

    const firstAck = jest.fn();
    middleware?.(['rtc:consume', {}, firstAck], next);
    expect(firstAck).toHaveBeenCalledWith({
      ok: false,
      error: 'RATE_LIMITED',
      retryAfterMs: 1_000,
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.[0]).toBe('socket:rate_limited');
    expect(emitted[0]?.[1]).toMatchObject<Partial<SocketRateLimitNotice>>({
      code: 'SOCKET_RATE_LIMITED',
      event: 'rtc:consume',
      category: 'rtc',
      disconnecting: false,
    });

    middleware?.(['rtc:consume', {}, jest.fn()], next);
    expect(emitted).toHaveLength(1);
    expect(fakeSocket.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects only after sustained rejected traffic crosses the abuse threshold', () => {
    const subject = limiter({
      perSocket: { mutation: { capacity: 1, refillPerSecond: 0.1 } },
      perUser: { mutation: { capacity: 1, refillPerSecond: 0.1 } },
      abuseMaxRejected: 3,
    });
    let middleware:
      | ((packet: [string, ...unknown[]], next: (err?: Error) => void) => void)
      | undefined;
    const fakeSocket = {
      id: 'socket-a',
      data: { userId: 'user-a' },
      use: jest.fn((fn: typeof middleware) => {
        middleware = fn;
      }),
      on: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as Socket;

    attachSocketEventRateLimiter(fakeSocket, subject);
    middleware?.(['chat:send', {}], jest.fn());
    for (let i = 0; i < 3; i += 1) middleware?.(['chat:send', {}], jest.fn());

    expect(fakeSocket.disconnect).toHaveBeenCalledTimes(1);
    expect(fakeSocket.disconnect).toHaveBeenCalledWith(true);
    expect(fakeSocket.emit).toHaveBeenLastCalledWith(
      'socket:rate_limited',
      expect.objectContaining({ disconnecting: true }),
    );
  });

  it('drops a limited packet before a real Socket.IO feature handler runs', async () => {
    const httpServer = http.createServer();
    const io = new Server(httpServer, { transports: ['websocket'] });
    const subject = limiter({
      perSocket: { mutation: { capacity: 1, refillPerSecond: 1 } },
      perUser: { mutation: { capacity: 1, refillPerSecond: 1 } },
    });
    let handlerCalls = 0;

    io.on('connection', socket => {
      socket.data.userId = 'user-a';
      attachSocketEventRateLimiter(socket, subject);
      socket.on('chat:send', (_payload: unknown, ack?: (ok: boolean) => void) => {
        handlerCalls += 1;
        ack?.(true);
      });
    });

    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address() as AddressInfo;
    const client = ioClient(`http://127.0.0.1:${address.port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        client.once('connect', resolve);
        client.once('connect_error', reject);
      });
      const emitChat = (): Promise<boolean> =>
        new Promise(resolve => client.emit('chat:send', { content: 'hello' }, resolve));

      expect(await emitChat()).toBe(true);
      const notice = new Promise<SocketRateLimitNotice>(resolve => {
        client.once('socket:rate_limited', resolve);
      });
      expect(await emitChat()).toBe(false);
      await expect(notice).resolves.toMatchObject({
        code: 'SOCKET_RATE_LIMITED',
        event: 'chat:send',
        category: 'mutation',
        disconnecting: false,
      });
      expect(handlerCalls).toBe(1);
    } finally {
      client.disconnect();
      await new Promise<void>(resolve => io.close(() => resolve()));
    }
  });

  it('closes a connection before handlers parse an oversized payload', async () => {
    const httpServer = http.createServer();
    const io = new Server(httpServer, {
      transports: ['websocket'],
      maxHttpBufferSize: MAX_SOCKET_PAYLOAD_BYTES,
    });
    let handlerCalls = 0;
    io.on('connection', socket => {
      socket.on('chat:send', () => {
        handlerCalls += 1;
      });
    });

    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address() as AddressInfo;
    const client = ioClient(`http://127.0.0.1:${address.port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        client.once('connect', resolve);
        client.once('connect_error', reject);
      });
      const disconnected = new Promise<void>(resolve => client.once('disconnect', () => resolve()));
      client.emit('chat:send', { content: 'x'.repeat(MAX_SOCKET_PAYLOAD_BYTES + 1) });
      await disconnected;
      expect(handlerCalls).toBe(0);
    } finally {
      client.disconnect();
      await new Promise<void>(resolve => io.close(() => resolve()));
    }
  });
});
