import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { contactsService } from './contacts.service';

export const contactsRouter: Router = Router();

contactsRouter.use(requireAuth);

// Raw E.164 numbers (sent over TLS, never persisted). Capped to bound the
// query and throttle enumeration attempts.
const matchSchema = z.object({
  phoneNumbers: z.array(z.string().regex(/^\+\d{6,15}$/)).max(2_000),
});

// NOTE: the `GET /salt` endpoint was removed. Hashing moved out entirely —
// matching is now an indexed lookup on the unique `phoneNumber` column.

contactsRouter.post(
  '/match',
  asyncHandler(async (req, res) => {
    const { phoneNumbers } = matchSchema.parse(req.body);
    const userId = authedUserId(req);
    const matches = await contactsService.match(userId, phoneNumbers);
    res.json({ matches, count: matches.length });
  }),
);
