import type { Request } from 'express';
import { AppError } from '../middlewares/error.middleware';

/**
 * Returns the authenticated user id, throwing AUTH_003 if it is somehow
 * absent. Use this instead of `req.userId!` on routes mounted behind
 * `requireAuth`: it is type-safe (no non-null assertion) and fails loudly
 * rather than silently passing `undefined` downstream if the middleware
 * order is ever changed.
 */
export const authedUserId = (req: Request): string => {
  if (!req.userId) throw new AppError('AUTH_003');
  return req.userId;
};
