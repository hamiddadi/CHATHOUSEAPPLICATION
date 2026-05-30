import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { clubMetaService } from './clubMeta.service';

export const clubMetaRouter: Router = Router();

clubMetaRouter.use(requireAuth);

const coverSchema = z.object({
  coverUrl: z.string().url().max(500),
});

clubMetaRouter.get(
  '/:clubId',
  asyncHandler(async (req, res) => {
    // getForCaller enforces PRIVATE-club read access (IDOR fix) before reading.
    const meta = await clubMetaService.getForCaller(authedUserId(req), String(req.params.clubId));
    res.json(meta);
  }),
);

clubMetaRouter.patch(
  '/:clubId/cover',
  asyncHandler(async (req, res) => {
    const { coverUrl } = coverSchema.parse(req.body);
    const meta = await clubMetaService.setCover(
      String(req.params.clubId),
      authedUserId(req),
      coverUrl,
    );
    res.json(meta);
  }),
);

clubMetaRouter.post(
  '/:clubId/featured/:userId',
  asyncHandler(async (req, res) => {
    const meta = await clubMetaService.addFeatured(
      String(req.params.clubId),
      authedUserId(req),
      String(req.params.userId),
    );
    res.json(meta);
  }),
);

clubMetaRouter.delete(
  '/:clubId/featured/:userId',
  asyncHandler(async (req, res) => {
    const meta = await clubMetaService.removeFeatured(
      String(req.params.clubId),
      authedUserId(req),
      String(req.params.userId),
    );
    res.json(meta);
  }),
);
