import {
  type ClientRateLimitInfo,
  type IncrementResponse,
  type Options as RateLimitOptions,
  type Store,
} from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';

type SendCommand = (...args: string[]) => Promise<RedisReply>;

type ConnectedRedisStoreOptions = {
  prefix: string;
  isReady: () => boolean;
  sendCommand: SendCommand;
};

/**
 * `rate-limit-redis` eagerly loads its Lua scripts in the constructor. API
 * limiters are created while modules are imported, before the application's
 * explicit Redis connection phase, so constructing RedisStore there would
 * issue commands against a closed node-redis client.
 *
 * This adapter preserves that explicit lifecycle: it records express-rate-
 * limit's configuration synchronously, then creates the real RedisStore only
 * on the first operation and only while Redis is ready. Readiness is checked
 * again for every raw command so a reconnect race fails the request closed
 * instead of bypassing a security/cost-control limit.
 */
export class ConnectedRedisStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;

  private readonly isReady: () => boolean;
  private readonly sendCommand: SendCommand;
  private options: RateLimitOptions | undefined;
  private delegate: RedisStore | undefined;

  constructor(options: ConnectedRedisStoreOptions) {
    this.prefix = options.prefix;
    this.isReady = options.isReady;
    this.sendCommand = options.sendCommand;
  }

  init(options: RateLimitOptions): void {
    this.options = options;
    this.delegate?.init(options);
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    return this.getDelegate().get(key);
  }

  async increment(key: string): Promise<IncrementResponse> {
    return this.getDelegate().increment(key);
  }

  async decrement(key: string): Promise<void> {
    return this.getDelegate().decrement(key);
  }

  async resetKey(key: string): Promise<void> {
    return this.getDelegate().resetKey(key);
  }

  private getDelegate(): RedisStore {
    if (!this.isReady()) {
      throw new Error('Redis rate-limit store is not ready');
    }
    if (!this.options) {
      throw new Error('Redis rate-limit store was not initialized');
    }

    if (!this.delegate) {
      const delegate = new RedisStore({
        prefix: this.prefix,
        sendCommand: (...args: string[]) => {
          if (!this.isReady()) {
            return Promise.reject(new Error('Redis rate-limit store is not ready'));
          }
          return this.sendCommand(...args);
        },
      });

      // The upstream constructor starts both script loads concurrently. Attach
      // rejection handlers immediately so a connection loss between the
      // readiness check and SCRIPT LOAD cannot become an unhandled rejection.
      // RedisStore still observes the original rejected promises and reloads
      // either script on the next operation.
      void delegate.incrementScriptSha.catch(() => undefined);
      void delegate.getScriptSha.catch(() => undefined);

      delegate.init(this.options);
      this.delegate = delegate;
    }

    return this.delegate;
  }
}
