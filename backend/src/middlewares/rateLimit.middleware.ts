import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env';
import { ERROR_CODES } from './error.middleware';

const baseMessage = {
  success: false,
  error: { code: 'RATE_LIMIT_001', message: ERROR_CODES.RATE_LIMIT_001.message },
} as const;

// All limiters share the same window/header/message policy; only `max`,
// `skip` and `skipSuccessfulRequests` vary per limiter.
const makeLimiter = (opts: Partial<Parameters<typeof rateLimit>[0]>) =>
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    standardHeaders: true,
    legacyHeaders: false,
    message: baseMessage,
    ...opts,
  });

/**
 * Global limiter — blanket protection for every `/api/*` route.
 * Tune per-route via `authLimiter` for high-risk endpoints.
 */
export const globalLimiter = makeLimiter({
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
export const authLimiter = makeLimiter({
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
export const sendLimiter = makeLimiter({
  max: env.AUTH_RATE_LIMIT_MAX,
});
