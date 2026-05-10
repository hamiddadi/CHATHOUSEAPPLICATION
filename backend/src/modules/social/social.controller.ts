import type { Request, Response } from 'express';
import { sendOk } from '../../utils/response';
import { AppError } from '../../middlewares/error.middleware';
import { reportRoomSchema, reportSchema } from './social.schema';
import { socialService } from './social.service';

const uid = (req: Request): string => {
  if (!req.userId) throw new AppError('AUTH_003');
  return req.userId;
};

const targetId = (req: Request): string => {
  const raw = req.params['id'];
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id) throw new AppError('USER_001');
  return id;
};

export const socialController = {
  async wave(req: Request, res: Response) {
    const result = await socialService.wave(uid(req), targetId(req));
    sendOk(res, result);
  },

  async block(req: Request, res: Response) {
    const result = await socialService.block(uid(req), targetId(req));
    sendOk(res, result);
  },

  async unblock(req: Request, res: Response) {
    const result = await socialService.unblock(uid(req), targetId(req));
    sendOk(res, result);
  },

  async listBlocked(req: Request, res: Response) {
    const rows = await socialService.listBlocked(uid(req));
    sendOk(res, rows);
  },

  async report(req: Request, res: Response) {
    const input = reportSchema.parse(req.body);
    const result = await socialService.report(uid(req), targetId(req), input);
    sendOk(res, result, 201);
  },

  async reportRoom(req: Request, res: Response) {
    const input = reportRoomSchema.parse(req.body);
    const result = await socialService.reportRoom(uid(req), targetId(req), input);
    sendOk(res, result, 201);
  },
};
