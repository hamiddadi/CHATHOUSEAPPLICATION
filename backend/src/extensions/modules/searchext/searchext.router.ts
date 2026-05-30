import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { searchExtService } from './searchext.service';

export const searchExtRouter: Router = Router();

searchExtRouter.use(requireAuth);

const querySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  topic: z.string().trim().min(1).max(64).optional(),
  language: z
    .string()
    .trim()
    .max(5)
    .regex(/^[a-z][a-z](-[A-Z][A-Z])?$/, 'iso639')
    .optional(),
  liveOnly: z
    .union([z.literal('true'), z.literal('false')])
    .transform(v => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

searchExtRouter.get(
  '/rooms',
  asyncHandler(async (req, res) => {
    const f = querySchema.parse(req.query);
    const items = await searchExtService.rooms(f);
    res.json({ items, count: items.length });
  }),
);
