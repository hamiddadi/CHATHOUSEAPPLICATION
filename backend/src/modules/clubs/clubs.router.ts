import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { clubsController } from './clubs.controller';

export const clubsRouter: Router = Router();

clubsRouter.use(requireAuth);

clubsRouter.get('/', asyncHandler(clubsController.list));
clubsRouter.post('/', asyncHandler(clubsController.create));
clubsRouter.get('/:id', asyncHandler(clubsController.get));
clubsRouter.patch('/:id', asyncHandler(clubsController.update));
clubsRouter.delete('/:id', asyncHandler(clubsController.remove));
// Membership actions (idempotent). Repeating an action is a no-op-ish call
// that returns a differentiated status rather than a 500/duplicate-key:
//   POST /:id/join   → 200, or 409 CLUB_004 if already a member
//   POST /:id/leave  → 200 (safe to call when not a member)
//   POST /:id/accept → 200, or 403 CLUB_007 without a valid invitation
// (handled in clubsService; see OpenAPI for the full response matrix).
clubsRouter.post('/:id/join', asyncHandler(clubsController.join));
clubsRouter.post('/:id/leave', asyncHandler(clubsController.leave));
clubsRouter.post('/:id/invite', asyncHandler(clubsController.invite));
clubsRouter.post('/:id/accept', asyncHandler(clubsController.accept));
