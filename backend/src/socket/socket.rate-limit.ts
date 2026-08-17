import type { Socket } from 'socket.io';
import { getUserId } from './socket.middleware';

// Socket.IO enforces this before JSON/MessagePack decoding and before packet
// middleware. Business payloads (including mediasoup RTP capabilities) stay
// far below 128 KiB; larger frames are treated as abusive.
export const MAX_SOCKET_PAYLOAD_BYTES = 128 * 1_024;

export type SocketEventCategory =
  | 'rtc'
  | 'captions'
  | 'presence'
  | 'location'
  | 'ephemeral'
  | 'probe'
  | 'mutation';

interface BucketSpec {
  capacity: number;
  refillPerSecond: number;
}

interface BucketState {
  tokens: number;
  updatedAt: number;
}

interface ScopeState {
  overall: BucketState;
  categories: Map<SocketEventCategory, BucketState>;
}

interface SocketState extends ScopeState {
  userId: string;
  lastNoticeAt: number;
}

interface UserState extends ScopeState {
  socketIds: Set<string>;
  rejectedSince: number;
  rejectedCount: number;
  lastSeenAt: number;
}

export interface SocketRateLimiterOptions {
  now?: () => number;
  socketOverall?: BucketSpec;
  userOverall?: BucketSpec;
  perSocket?: Partial<Record<SocketEventCategory, BucketSpec>>;
  perUser?: Partial<Record<SocketEventCategory, BucketSpec>>;
  abuseWindowMs?: number;
  abuseMaxRejected?: number;
  noticeIntervalMs?: number;
  userStateRetentionMs?: number;
}

export interface SocketRateLimitDecision {
  allowed: boolean;
  category: SocketEventCategory;
  retryAfterMs: number;
  notify: boolean;
  disconnect: boolean;
}

export interface SocketRateLimitNotice {
  code: 'SOCKET_RATE_LIMITED';
  event: string;
  category: SocketEventCategory;
  retryAfterMs: number;
  disconnecting: boolean;
}

interface RedisEvalClient {
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

interface DistributedQuotaSpec {
  limit: number;
  windowMs: number;
}

const DISTRIBUTED_QUOTAS: Partial<Record<SocketEventCategory, DistributedQuotaSpec>> = {
  captions: { limit: 2_400, windowMs: 60_000 },
  presence: { limit: 12, windowMs: 60_000 },
  location: { limit: 240, windowMs: 60_000 },
  mutation: { limit: 600, windowMs: 60_000 },
};

const DISTRIBUTED_QUOTA_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

/** Coarse account budget shared by every horizontally-scaled Socket.IO node. */
export class DistributedSocketEventRateLimiter {
  constructor(
    private readonly client: RedisEvalClient,
    private readonly now: () => number = Date.now,
  ) {}

  async check(
    userId: string,
    category: SocketEventCategory,
  ): Promise<{ allowed: boolean; retryAfterMs: number }> {
    const spec = DISTRIBUTED_QUOTAS[category];
    if (!spec) return { allowed: true, retryAfterMs: 0 };
    const window = Math.floor(this.now() / spec.windowMs);
    const raw = await this.client.eval(DISTRIBUTED_QUOTA_SCRIPT, {
      keys: [`socket:quota:${category}:${userId}:${window}`],
      arguments: [String(spec.windowMs)],
    });
    if (!Array.isArray(raw)) throw new Error('Invalid distributed socket quota response');
    const count = Number(raw[0]);
    const ttl = Math.max(1, Number(raw[1]) || spec.windowMs);
    return { allowed: Number.isFinite(count) && count <= spec.limit, retryAfterMs: ttl };
  }
}

const DEFAULT_SOCKET_OVERALL: BucketSpec = { capacity: 240, refillPerSecond: 60 };
const DEFAULT_USER_OVERALL: BucketSpec = { capacity: 360, refillPerSecond: 90 };
const DEFAULT_USER_STATE_RETENTION_MS = 5 * 60 * 1_000;

/**
 * Limits are intentionally generous for audio signalling and live captions:
 * they stop floods without turning a room reconnect or normal interim speech
 * transcript into a self-inflicted outage.
 */
const DEFAULT_PER_SOCKET: Record<SocketEventCategory, BucketSpec> = {
  rtc: { capacity: 100, refillPerSecond: 25 },
  captions: { capacity: 30, refillPerSecond: 20 },
  presence: { capacity: 4, refillPerSecond: 0.1 },
  location: { capacity: 15, refillPerSecond: 2 },
  ephemeral: { capacity: 30, refillPerSecond: 10 },
  probe: { capacity: 10, refillPerSecond: 2 },
  mutation: { capacity: 30, refillPerSecond: 5 },
};

// A user may legitimately have a phone and tablet connected simultaneously.
// Account-wide budgets therefore allow twice the per-socket traffic, while
// still preventing an attacker from multiplying throughput with many sockets.
const DEFAULT_PER_USER: Record<SocketEventCategory, BucketSpec> = {
  rtc: { capacity: 200, refillPerSecond: 50 },
  captions: { capacity: 60, refillPerSecond: 40 },
  presence: { capacity: 8, refillPerSecond: 0.2 },
  location: { capacity: 30, refillPerSecond: 4 },
  ephemeral: { capacity: 60, refillPerSecond: 20 },
  probe: { capacity: 20, refillPerSecond: 4 },
  mutation: { capacity: 60, refillPerSecond: 10 },
};

const classifyEvent = (event: string): SocketEventCategory => {
  if (event.startsWith('rtc:')) return 'rtc';
  if (event === 'caption:publish') return 'captions';
  if (event === 'presence_update') return 'presence';
  if (event === 'maps:update-location') return 'location';
  if (event === 'chat:typing') return 'ephemeral';
  if (event === 'rtt:ping') return 'probe';
  return 'mutation';
};

const newBucket = (spec: BucketSpec, now: number): BucketState => ({
  tokens: spec.capacity,
  updatedAt: now,
});

const refill = (bucket: BucketState, spec: BucketSpec, now: number): void => {
  const elapsedMs = Math.max(0, now - bucket.updatedAt);
  bucket.tokens = Math.min(
    spec.capacity,
    bucket.tokens + (elapsedMs / 1_000) * spec.refillPerSecond,
  );
  bucket.updatedAt = now;
};

const retryAfter = (bucket: BucketState, spec: BucketSpec): number =>
  Math.max(1, Math.ceil(((1 - bucket.tokens) / spec.refillPerSecond) * 1_000));

/**
 * In-memory, per-node protection. The socket budget protects a concrete
 * connection; the user budget aggregates every device connected to this node.
 * This intentionally avoids a Redis round-trip on each audio signalling
 * packet. The outer per-socket limit still protects every horizontally-scaled
 * node independently.
 */
export class SocketEventRateLimiter {
  private readonly now: () => number;
  private readonly socketOverall: BucketSpec;
  private readonly userOverall: BucketSpec;
  private readonly perSocket: Record<SocketEventCategory, BucketSpec>;
  private readonly perUser: Record<SocketEventCategory, BucketSpec>;
  private readonly abuseWindowMs: number;
  private readonly abuseMaxRejected: number;
  private readonly noticeIntervalMs: number;
  private readonly userStateRetentionMs: number;
  private lastUserPruneAt = Number.NEGATIVE_INFINITY;
  private readonly sockets = new Map<string, SocketState>();
  private readonly users = new Map<string, UserState>();

  constructor(options: SocketRateLimiterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.socketOverall = options.socketOverall ?? DEFAULT_SOCKET_OVERALL;
    this.userOverall = options.userOverall ?? DEFAULT_USER_OVERALL;
    this.perSocket = { ...DEFAULT_PER_SOCKET, ...options.perSocket };
    this.perUser = { ...DEFAULT_PER_USER, ...options.perUser };
    this.abuseWindowMs = options.abuseWindowMs ?? 10_000;
    this.abuseMaxRejected = options.abuseMaxRejected ?? 120;
    this.noticeIntervalMs = options.noticeIntervalMs ?? 1_000;
    this.userStateRetentionMs = options.userStateRetentionMs ?? DEFAULT_USER_STATE_RETENTION_MS;
  }

  register(socketId: string, userId: string): void {
    this.unregister(socketId);
    const now = this.now();
    this.pruneIdleUsers(now);
    this.sockets.set(socketId, {
      userId,
      overall: newBucket(this.socketOverall, now),
      categories: new Map(),
      lastNoticeAt: Number.NEGATIVE_INFINITY,
    });

    const existingUser = this.users.get(userId);
    if (existingUser) {
      existingUser.socketIds.add(socketId);
      existingUser.lastSeenAt = now;
    } else {
      this.users.set(userId, {
        overall: newBucket(this.userOverall, now),
        categories: new Map(),
        socketIds: new Set([socketId]),
        rejectedSince: now,
        rejectedCount: 0,
        lastSeenAt: now,
      });
    }
  }

  unregister(socketId: string): void {
    const socketState = this.sockets.get(socketId);
    if (!socketState) return;
    this.sockets.delete(socketId);

    const userState = this.users.get(socketState.userId);
    userState?.socketIds.delete(socketId);
    if (userState) userState.lastSeenAt = this.now();
  }

  check(socketId: string, event: string): SocketRateLimitDecision {
    const now = this.now();
    const category = classifyEvent(event);
    const socketState = this.sockets.get(socketId);
    if (!socketState) {
      throw new Error(`Socket ${socketId} must be registered before rate-limit checks`);
    }
    const userState = this.users.get(socketState.userId);
    if (!userState) {
      throw new Error(`User ${socketState.userId} must be registered before rate-limit checks`);
    }
    userState.lastSeenAt = now;

    const socketCategorySpec = this.perSocket[category];
    const userCategorySpec = this.perUser[category];
    const socketCategory = this.categoryBucket(
      socketState.categories,
      category,
      socketCategorySpec,
      now,
    );
    const userCategory = this.categoryBucket(userState.categories, category, userCategorySpec, now);
    const checks: Array<[BucketState, BucketSpec]> = [
      [socketState.overall, this.socketOverall],
      [userState.overall, this.userOverall],
      [socketCategory, socketCategorySpec],
      [userCategory, userCategorySpec],
    ];

    for (const [bucket, spec] of checks) refill(bucket, spec, now);
    const exhausted = checks.filter(([bucket]) => bucket.tokens < 1);
    if (exhausted.length === 0) {
      for (const [bucket] of checks) bucket.tokens -= 1;
      return { allowed: true, category, retryAfterMs: 0, notify: false, disconnect: false };
    }

    if (now - userState.rejectedSince >= this.abuseWindowMs) {
      userState.rejectedSince = now;
      userState.rejectedCount = 0;
    }
    userState.rejectedCount += 1;

    const notify =
      socketState.lastNoticeAt === Number.NEGATIVE_INFINITY ||
      now - socketState.lastNoticeAt >= this.noticeIntervalMs;
    if (notify) socketState.lastNoticeAt = now;

    return {
      allowed: false,
      category,
      retryAfterMs: Math.max(...exhausted.map(([bucket, spec]) => retryAfter(bucket, spec))),
      notify,
      disconnect: userState.rejectedCount >= this.abuseMaxRejected,
    };
  }

  private pruneIdleUsers(now: number): void {
    const pruneIntervalMs = Math.min(this.userStateRetentionMs, 60_000);
    if (now - this.lastUserPruneAt < pruneIntervalMs) return;
    this.lastUserPruneAt = now;
    for (const [userId, state] of this.users) {
      if (state.socketIds.size === 0 && now - state.lastSeenAt >= this.userStateRetentionMs) {
        this.users.delete(userId);
      }
    }
  }

  private categoryBucket(
    buckets: Map<SocketEventCategory, BucketState>,
    category: SocketEventCategory,
    spec: BucketSpec,
    now: number,
  ): BucketState {
    const existing = buckets.get(category);
    if (existing) return existing;
    const created = newBucket(spec, now);
    buckets.set(category, created);
    return created;
  }
}

const acknowledgeRejection = (
  event: string,
  packet: unknown[],
  notice: SocketRateLimitNotice,
): void => {
  const candidate = packet[packet.length - 1];
  if (typeof candidate !== 'function') return;
  const ack = candidate as (...args: unknown[]) => void;

  if (event.startsWith('rtc:')) {
    ack({ ok: false, error: 'RATE_LIMITED', retryAfterMs: notice.retryAfterMs });
  } else if (event === 'rtt:ping') {
    // Preserve the ping callback's object contract. The flood still counts
    // towards extreme-abuse disconnection, but an occasional excess probe
    // never becomes a misleading client-side timeout.
    ack({
      serverTime: Date.now(),
      echo: null,
      rateLimited: true,
      retryAfterMs: notice.retryAfterMs,
    });
  } else {
    // Existing room/chat/maps acknowledgements are booleans.
    ack(false);
  }
};

/**
 * Install the inbound Socket.IO packet middleware for one authenticated
 * socket. Limited packets are acknowledged locally and deliberately not
 * passed to feature handlers, so they cannot write to Postgres/Redis or fan
 * out broadcasts.
 */
export const attachSocketEventRateLimiter = (
  socket: Socket,
  limiter: SocketEventRateLimiter,
  distributedLimiter?: DistributedSocketEventRateLimiter,
): void => {
  const userId = getUserId(socket);
  limiter.register(socket.id, userId);

  socket.use((packet, next) => {
    const event = typeof packet[0] === 'string' ? packet[0] : '';
    const decision = limiter.check(socket.id, event);
    const reject = (retryAfterMs: number, notify: boolean, disconnect: boolean): void => {
      const notice: SocketRateLimitNotice = {
        code: 'SOCKET_RATE_LIMITED',
        event: event.slice(0, 80),
        category: decision.category,
        retryAfterMs,
        disconnecting: disconnect,
      };
      acknowledgeRejection(event, packet, notice);
      if (notify || disconnect) socket.emit('socket:rate_limited', notice);
      if (disconnect) socket.disconnect(true);
    };

    if (!decision.allowed) {
      reject(decision.retryAfterMs, decision.notify, decision.disconnect);
      return;
    }
    if (!distributedLimiter) {
      next();
      return;
    }

    void distributedLimiter
      .check(userId, decision.category)
      .then(globalDecision => {
        if (!socket.connected) return;
        if (globalDecision.allowed) next();
        else reject(globalDecision.retryAfterMs, true, false);
      })
      .catch(() => {
        // Mutating/caption/location/presence categories fail closed when the
        // shared quota store is unavailable. Hot RTC and probe categories do
        // not use Redis and already continued above with an allowed result.
        if (socket.connected) reject(1_000, true, false);
      });
  });

  socket.on('disconnect', () => limiter.unregister(socket.id));
};
