import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../../config/env';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { AppError } from '../../../middlewares/error.middleware';
import { contactMatchLimiter } from '../../../middlewares/rateLimit.middleware';
import { requireCurrentLegalAcceptance } from '../../../modules/auth/legal-acceptance';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { CONTACT_MATCH_MAX_NUMBERS, contactsService } from './contacts.service';

export const contactsRouter: Router = Router();

contactsRouter.use(requireAuth, requireCurrentLegalAcceptance);

// Raw E.164 numbers (sent over TLS, never persisted). Capped to bound the
// query and throttle enumeration attempts.
export const matchSchema = z.object({
  phoneNumbers: z.array(z.string().regex(/^\+[1-9]\d{7,14}$/)).max(CONTACT_MATCH_MAX_NUMBERS),
});

// NOTE: the `GET /salt` endpoint was removed. Hashing moved out entirely —
// matching is now an indexed lookup on the unique `phoneNumber` column.

contactsRouter.post(
  '/match',
  contactMatchLimiter,
  asyncHandler(async (req, res) => {
    if (!env.CONTACT_MATCH_ENABLED) throw new AppError('CONTACT_001');
    const { phoneNumbers } = matchSchema.parse(req.body);
    const userId = authedUserId(req);
    const matches = await contactsService.match(userId, phoneNumbers);
    res.json({ matches, count: matches.length });
  }),
);
