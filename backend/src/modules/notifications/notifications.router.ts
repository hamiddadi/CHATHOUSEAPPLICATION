import type { Request, Response } from 'express';
import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { sendOk } from '../../utils/response';
import { AppError } from '../../middlewares/error.middleware';
import { authedUserId as uid } from '../../utils/authedUserId';
import { notificationsService, parseFilter } from './notifications.service';

export const notificationsRouter: Router = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = parseFilter(req.query['filter']);
    const limitRaw = req.query['limit'];
    const parsedLimit = typeof limitRaw === 'string' ? Number(limitRaw) : NaN;
    const limit = Number.isFinite(parsedLimit) ? Math.min(50, Math.max(1, parsedLimit)) : 50;
    const cursor = typeof req.query['cursor'] === 'string' ? req.query['cursor'] : undefined;
    const page = await notificationsService.list(uid(req), filter, limit, cursor);
    // Return the array directly (matches the OpenAPI contract: data: array).
    // The clients read `data` as the notification array; wrapping the paginated
    // object here made them `.map` over an object and crash.
    sendOk(res, page.data);
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
