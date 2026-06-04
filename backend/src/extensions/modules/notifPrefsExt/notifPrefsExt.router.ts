import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../middlewares/auth.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { authedUserId } from '../../../utils/authedUserId';
import { notifPrefsExtService } from './notifPrefsExt.service';

export const notifPrefsExtRouter: Router = Router();

notifPrefsExtRouter.use(requireAuth);

const freqSchema = z.object({
  frequency: z.enum(['infrequent', 'normal', 'frequent']),
});

notifPrefsExtRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const [frequency, mutedClubs, mutedUsers] = await Promise.all([
      notifPrefsExtService.getFrequency(authedUserId(req)),
      notifPrefsExtService.listMutedClubs(authedUserId(req)),
      notifPrefsExtService.listMutedUsers(authedUserId(req)),
    ]);
    res.json({ frequency, mutedClubs, mutedUsers });
  }),
);

notifPrefsExtRouter.patch(
  '/frequency',
  asyncHandler(async (req, res) => {
    const { frequency } = freqSchema.parse(req.body);
    await notifPrefsExtService.setFrequency(authedUserId(req), frequency);
    res.json({ frequency });
  }),
);

notifPrefsExtRouter.post(
  '/clubs/:clubId/mute',
  asyncHandler(async (req, res) => {
    await notifPrefsExtService.muteClub(authedUserId(req), String(req.params.clubId));
    res.json({ muted: true });
  }),
);

notifPrefsExtRouter.delete(
  '/clubs/:clubId/mute',
  asyncHandler(async (req, res) => {
    await notifPrefsExtService.unmuteClub(authedUserId(req), String(req.params.clubId));
    res.json({ muted: false });
  }),
);

notifPrefsExtRouter.post(
  '/users/:userId/mute',
  asyncHandler(async (req, res) => {
    await notifPrefsExtService.muteUser(authedUserId(req), String(req.params.userId));
    res.json({ muted: true });
  }),
);

notifPrefsExtRouter.delete(
  '/users/:userId/mute',
  asyncHandler(async (req, res) => {
    await notifPrefsExtService.unmuteUser(authedUserId(req), String(req.params.userId));
    res.json({ muted: false });
  }),
);
