import type { Request, Response } from 'express';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { sendOk } from '../../utils/response';
import { AppError, ERROR_CODES } from '../../middlewares/error.middleware';
import { usersService } from '../users/users.service';
import { locationSchema } from '../users/users.schema';

/**
 * PATCH /location writes sensitive GPS data and gets hammered by mobile
 * clients on the move. The blanket globalLimiter is too loose for a
 * per-user write that overwrites latitude/longitude/lastSeenAt — cap it
 * to ~1 update / 10s per user (6 / minute). Keyed on the authenticated
 * userId (set by requireAuth) so it throttles the device, not the egress IP.
 */
const locationLimiter = rateLimit({
  windowMs: 60_000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.userId ?? req.ip ?? 'anonymous',
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_001', message: ERROR_CODES.RATE_LIMIT_001.message },
  },
});

/**
 * Maps endpoints are thin wrappers over usersService — location persistence
 * is on the user row, there is no separate "location" resource. Two entry
 * points here for REST ergonomics; the heavy lifting (Ghost Mode filtering,
 * 30-min staleness cutoff) lives in usersService.getOnlineLocations.
 */
export const mapsRouter: Router = Router();

mapsRouter.use(requireAuth);

mapsRouter.get(
  '/users',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.userId) throw new AppError('AUTH_003');
    const rows = await usersService.getOnlineLocations(req.userId);
    sendOk(res, rows);
  }),
);

// Initial roster for the followers-on-map feature: the people the caller
// follows who are visible + online + recently located. The socket only
// streams coordinate deltas afterwards.
mapsRouter.get(
  '/followers',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.userId) throw new AppError('AUTH_003');
    const rows = await usersService.getFollowingOnMap(req.userId);
    sendOk(res, rows);
  }),
);

mapsRouter.patch(
  '/location',
  locationLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.userId) throw new AppError('AUTH_003');
    const input = locationSchema.parse(req.body);
    const row = await usersService.setLocation(req.userId, input);
    sendOk(res, row);
  }),
);
