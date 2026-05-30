import { z } from 'zod';
import type { Request, Response } from 'express';
import { sendOk } from '../../utils/response';
import { AppError } from '../../middlewares/error.middleware';
import { authedUserId as requireUserId } from '../../utils/authedUserId';
import { followService } from './follow.service';

// Shared list pagination guard. Replaces the hand-rolled Number()/string
// parsing that let `limit=abc` reach Prisma as NaN and an invalid `cursor`
// reach `new Date(cursor)` as Invalid Date. `cursor` is an ISO timestamp
// (the followed-row createdAt) the service feeds to `createdAt: { lt }`.
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(50),
  cursor: z.string().datetime().optional(),
});

const targetId = (req: Request): string => {
  const raw = req.params['userId'];
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id) throw new AppError('USER_001');
  return id;
};

export const followController = {
  async follow(req: Request, res: Response) {
    const result = await followService.follow(requireUserId(req), targetId(req));
    sendOk(res, result);
  },

  async unfollow(req: Request, res: Response) {
    const result = await followService.unfollow(requireUserId(req), targetId(req));
    sendOk(res, result);
  },

  async followers(req: Request, res: Response) {
    const { limit, cursor } = listQuerySchema.parse(req.query);
    const result = await followService.listFollowers(requireUserId(req), limit, cursor);
    sendOk(res, result);
  },

  async following(req: Request, res: Response) {
    const { limit, cursor } = listQuerySchema.parse(req.query);
    const result = await followService.listFollowing(requireUserId(req), limit, cursor);
    sendOk(res, result);
  },

  // Followers / following of an arbitrary user (public lists), so the app can
  // render other profiles' follow lists — not just the authenticated user's.
  async followersOf(req: Request, res: Response) {
    requireUserId(req); // auth required, but the list is the target's
    const { limit, cursor } = listQuerySchema.parse(req.query);
    const result = await followService.listFollowers(targetId(req), limit, cursor);
    sendOk(res, result);
  },

  async followingOf(req: Request, res: Response) {
    requireUserId(req);
    const { limit, cursor } = listQuerySchema.parse(req.query);
    const result = await followService.listFollowing(targetId(req), limit, cursor);
    sendOk(res, result);
  },

  async mutualFollowers(req: Request, res: Response) {
    const raw = req.params['id'];
    const id = Array.isArray(raw) ? raw[0] : raw;
    if (!id) throw new AppError('USER_001');
    const result = await followService.mutualFollowers(requireUserId(req), id);
    sendOk(res, result);
  },
};
