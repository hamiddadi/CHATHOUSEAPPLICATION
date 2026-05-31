import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { invitesService } from './invites.service';

export const invitesRouter: Router = Router();

invitesRouter.use(requireAuth);

/**
 * GET /api/ext/invites/link
 * Returns the authenticated user's personal signed invite URL plus how many
 * invites they have left. The link encodes + signs the inviter so attribution
 * works at redemption time without any DB write here.
 */
invitesRouter.get(
  '/link',
  asyncHandler(async (req, res) => {
    const userId = authedUserId(req);
    const { url, code } = invitesService.linkFor(userId);
    const remaining = await invitesService.invitesRemaining(userId);
    res.json({ url, code, remaining });
  }),
);

const redeemSchema = z.object({ code: z.string().min(1).max(512) });

/**
 * POST /api/ext/invites/redeem  { code }
 * Attributes the authenticated (freshly onboarded) user to the inviter encoded
 * in `code`, consuming one of the inviter's invites. Idempotent and quota-safe;
 * always 200 with a structured result so the client can proceed regardless of
 * whether attribution succeeded.
 */
invitesRouter.post(
  '/redeem',
  asyncHandler(async (req, res) => {
    const userId = authedUserId(req);
    const { code } = redeemSchema.parse(req.body);
    const result = await invitesService.redeem(userId, code);
    res.json(result);
  }),
);
