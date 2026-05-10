import type { Request, Response } from 'express';
import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { sendOk } from '../../utils/response';
import { AppError } from '../../middlewares/error.middleware';
import { notificationsService } from './notifications.service';

export const notificationsRouter: Router = Router();

notificationsRouter.use(requireAuth);

const uid = (req: Request): string => {
  if (!req.userId) throw new AppError('AUTH_003');
  return req.userId;
};

const FILTER_VALUES = ['all', 'rooms', 'social', 'clubs'] as const;
type FilterValue = (typeof FILTER_VALUES)[number];

const isFilter = (v: unknown): v is FilterValue =>
  typeof v === 'string' && (FILTER_VALUES as readonly string[]).includes(v);

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const raw = req.query['filter'];
    const filter = isFilter(raw) ? raw : 'all';
    const rows = await notificationsService.list(uid(req), filter);
    sendOk(res, rows);
  }),
);

notificationsRouter.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const result = await notificationsService.unreadCount(uid(req));
    sendOk(res, result);
  }),
);

notificationsRouter.patch(
  '/read-all',
  asyncHandler(async (req, res) => {
    const result = await notificationsService.markAllRead(uid(req));
    sendOk(res, result);
  }),
);

// Pull out the path-param helper so the individual read + delete routes
// both use it and don't duplicate the null-check.
const paramId = (req: Request): string => {
  const raw = req.params['id'];
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id) throw new AppError('NOT_FOUND_001');
  return id;
};

notificationsRouter.patch(
  '/:id/read',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await notificationsService.markOneRead(uid(req), paramId(req));
    sendOk(res, result);
  }),
);

notificationsRouter.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await notificationsService.remove(uid(req), paramId(req));
    sendOk(res, result);
  }),
);
