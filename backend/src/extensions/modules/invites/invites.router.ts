import { Router } from 'express';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { invitesService } from './invites.service';

export const invitesRouter: Router = Router();

invitesRouter.use(requireAuth);

/**
 * GET /api/ext/invites/link
 * Returns the authenticated user's personal invite URL. The link encodes the
 * inviter so attribution works at redemption time without any DB write.
 */
invitesRouter.get(
  '/link',
  asyncHandler(async (req, res) => {
    const userId = authedUserId(req);
    const { url, code } = invitesService.linkFor(userId);
    res.json({ url, code });
  }),
);
