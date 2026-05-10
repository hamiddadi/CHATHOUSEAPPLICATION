import type { Request, Response } from 'express';
import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { sendOk } from '../../utils/response';
import { AppError } from '../../middlewares/error.middleware';
import { usersService } from '../users/users.service';
import { locationSchema } from '../users/users.schema';

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

mapsRouter.patch(
  '/location',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.userId) throw new AppError('AUTH_003');
    const input = locationSchema.parse(req.body);
    const row = await usersService.setLocation(req.userId, input);
    sendOk(res, row);
  }),
);
