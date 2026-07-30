import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { rateLimit, type Options as RateLimitOptions } from 'express-rate-limit';
import type { RedisReply } from 'rate-limit-redis';
import request from 'supertest';
import { ConnectedRedisStore } from '../src/middlewares/connectedRedisStore';

const limiterOptions = { windowMs: 60_000 } as RateLimitOptions;

describe('ConnectedRedisStore', () => {
  it('does not issue Redis commands during construction or init', () => {
    const sendCommand = jest.fn<Promise<RedisReply>, string[]>();
    const store = new ConnectedRedisStore({
      prefix: 'rl:test:',
      isReady: () => false,
      sendCommand,
    });

    store.init(limiterOptions);

    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('fails closed without touching a disconnected Redis client', async () => {
    const sendCommand = jest.fn<Promise<RedisReply>, string[]>();
    const store = new ConnectedRedisStore({
      prefix: 'rl:test:',
      isReady: () => false,
      sendCommand,
    });
    store.init(limiterOptions);

    await expect(store.increment('client')).rejects.toThrow('Redis rate-limit store is not ready');
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('loads scripts lazily and delegates counters once Redis is ready', async () => {
    let ready = false;
    const commands: string[][] = [];
    const sendCommand = jest.fn(async (...args: string[]): Promise<RedisReply> => {
      commands.push(args);
      if (args[0] === 'SCRIPT') return `sha-${commands.length}`;
      if (args[0] === 'EVALSHA') return ['1', '60000'];
      throw new Error(`Unexpected Redis command: ${args[0] ?? 'missing'}`);
    });
    const store = new ConnectedRedisStore({
      prefix: 'rl:test:',
      isReady: () => ready,
      sendCommand,
    });
    store.init(limiterOptions);

    expect(sendCommand).not.toHaveBeenCalled();
    ready = true;

    await expect(store.increment('client')).resolves.toMatchObject({ totalHits: 1 });
    expect(commands.filter(command => command[0] === 'SCRIPT')).toHaveLength(2);
    expect(commands.filter(command => command[0] === 'EVALSHA')).toHaveLength(1);
    expect(commands.find(command => command[0] === 'EVALSHA')).toContain('rl:test:client');
  });

  it('gates every operation when Redis disconnects after initialization', async () => {
    let ready = true;
    const sendCommand = jest.fn(async (...args: string[]): Promise<RedisReply> => {
      if (args[0] === 'SCRIPT') return 'sha';
      if (args[0] === 'EVALSHA') return ['1', '60000'];
      return 1;
    });
    const store = new ConnectedRedisStore({
      prefix: 'rl:test:',
      isReady: () => ready,
      sendCommand,
    });
    store.init(limiterOptions);

    await store.increment('first');
    const callsWhileReady = sendCommand.mock.calls.length;
    ready = false;

    await expect(store.increment('second')).rejects.toThrow('Redis rate-limit store is not ready');
    await expect(store.get('first')).rejects.toThrow('Redis rate-limit store is not ready');
    await expect(store.decrement('first')).rejects.toThrow('Redis rate-limit store is not ready');
    await expect(store.resetKey('first')).rejects.toThrow('Redis rate-limit store is not ready');
    expect(sendCommand).toHaveBeenCalledTimes(callsWhileReady);

    ready = true;
    await expect(store.increment('after-reconnect')).resolves.toMatchObject({ totalHits: 1 });
    expect(sendCommand.mock.calls.length).toBeGreaterThan(callsWhileReady);
  });

  it('does not bypass a protected route when Redis is unavailable', async () => {
    const protectedHandler = jest.fn<ReturnType<RequestHandler>, Parameters<RequestHandler>>(
      (_req, res) => {
        res.sendStatus(204);
      },
    );
    const store = new ConnectedRedisStore({
      prefix: 'rl:test:',
      isReady: () => false,
      sendCommand: jest.fn<Promise<RedisReply>, string[]>(),
    });
    const app = express();
    app.use(
      rateLimit({
        windowMs: 60_000,
        limit: 1,
        store,
        passOnStoreError: false,
      }),
    );
    app.get('/', protectedHandler);
    app.use((_error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      res.sendStatus(503);
    });

    await request(app).get('/').expect(503);
    expect(protectedHandler).not.toHaveBeenCalled();
  });

  it('still enforces the configured quota when Redis is ready', async () => {
    let hits = 0;
    const store = new ConnectedRedisStore({
      prefix: 'rl:test:',
      isReady: () => true,
      sendCommand: async (...args: string[]): Promise<RedisReply> => {
        if (args[0] === 'SCRIPT') return 'sha';
        if (args[0] === 'EVALSHA') {
          hits += 1;
          return [String(hits), '60000'];
        }
        return 1;
      },
    });
    const app = express();
    app.use(
      rateLimit({
        windowMs: 60_000,
        limit: 1,
        store,
        passOnStoreError: false,
      }),
    );
    app.get('/', (_req, res) => {
      res.sendStatus(204);
    });

    await request(app).get('/').expect(204);
    await request(app).get('/').expect(429);
  });
});
