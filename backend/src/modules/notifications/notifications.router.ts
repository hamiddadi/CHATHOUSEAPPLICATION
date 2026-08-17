import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { sendOk } from '../../utils/response';
import { AppError } from '../../middlewares/error.middleware';
import { authedUserId as uid } from '../../utils/authedUserId';
import { decodeTimeIdCursor } from '../../utils/timeIdCursor';
import { notificationsService, parseFilter } from './notifications.service';
import { materializePrivateMediaUrls } from '../media/media-url';

export const notificationsRouter: Router = Router();

notificationsRouter.use(requireAuth);

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(50),
  cursor: z
    .string()
    .max(1024)
    .refine(value => decodeTimeIdCursor(value) !== null, { message: 'Invalid notification cursor' })
    .optional(),
});

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = parseFilter(req.query['filter']);
    const { limit, cursor } = listQuerySchema.parse(req.query);
    const page = await notificationsService.list(uid(req), filter, limit, cursor);
    // Preserve `data` as an array for installed clients while exposing paging
    // metadata to newer clients at the envelope's top level.
    res.status(200).json({
      success: true,
      data: materializePrivateMediaUrls(page.data),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    });
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
