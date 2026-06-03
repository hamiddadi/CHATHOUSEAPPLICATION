import { rateLimit, type Store } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { redis } from '../config/redis';
import { env } from '../config/env';
import { ERROR_CODES } from './error.middleware';

const baseMessage = {
  success: false,
  error: { code: 'RATE_LIMIT_001', message: ERROR_CODES.RATE_LIMIT_001.message },
} as const;

/**
 * Redis-backed store so rate-limit counters are SHARED across every API
 * instance behind the load balancer. The default in-memory store counts
 * per-process — with N instances an attacker gets N× the quota, and every
 * redeploy/restart resets the counters, defeating the brute-force (login) and
 * cost-control (SMS/email/tip) ceilings. The shared node-redis client is
 * connected at boot by connectRedis(); `sendCommand` only runs per-request.
 *
 * Skipped in the `test` env: a single-process test run doesn't need a
 * distributed store, and a persistent Redis store would leak counters across
 * runs and make the suite flaky. Each limiter gets its own key prefix so their
 * counters never collide.
 */
const makeStore = (prefix: string): Store | undefined => {
  if (env.NODE_ENV === 'test') return undefined; // default MemoryStore
  return new RedisStore({
    prefix,
    sendCommand: (...args: string[]): Promise<RedisReply> =>
      redis.sendCommand(args) as Promise<RedisReply>,
  });
};

// All limiters share the same window/header/message policy; only `max`,
// `skip`, `skipSuccessfulRequests` and the store prefix vary per limiter.
const makeLimiter = (prefix: string, opts: Partial<Parameters<typeof rateLimit>[0]>) =>
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    standardHeaders: true,
    legacyHeaders: false,
    message: baseMessage,
    store: makeStore(prefix),
    ...opts,
  });

/**
 * Global limiter — blanket protection for every `/api/*` route.
 * Tune per-route via `authLimiter` for high-risk endpoints.
 */
export const globalLimiter = makeLimiter('rl:global:', {
  max: env.RATE_LIMIT_MAX,
  // Exempt /auth/dev-login in non-prod — it's a QA shortcut and rapid
  // reloads during Expo development shouldn't trip the limiter.
  skip: req => env.NODE_ENV !== 'production' && req.path === '/auth/dev-login',
});

/**
 * Stricter ceiling for login/register/forgot-password — slows brute-force
 * without hurting the normal user flow. `skipSuccessfulRequests` is fine
 * here because a *successful* login is not abuse.
 */
export const authLimiter = makeLimiter('rl:auth:', {
  max: env.AUTH_RATE_LIMIT_MAX,
  skipSuccessfulRequests: true,
});

/**
 * Ceiling for endpoints that trigger a COSTLY EXTERNAL side effect on
 * success — outbound SMS (send-otp) and email (forgot-password). Unlike
 * authLimiter this does NOT skip successful requests: a successful send IS
 * the thing we must cap, otherwise an attacker rotating phone numbers can
 * run up the Twilio/SMTP bill with zero HTTP throttling.
 */
export const sendLimiter = makeLimiter('rl:send:', {
  max: env.AUTH_RATE_LIMIT_MAX,
});
