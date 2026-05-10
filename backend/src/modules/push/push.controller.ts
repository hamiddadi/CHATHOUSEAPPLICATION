import type { Request, Response } from 'express';
import { sendOk } from '../../utils/response';
import { AppError } from '../../middlewares/error.middleware';
import { registerPushSchema, unregisterPushSchema } from './push.schema';
import { pushService } from './push.service';

const uid = (req: Request): string => {
  if (!req.userId) throw new AppError('AUTH_003');
  return req.userId;
};

export const pushController = {
  async register(req: Request, res: Response) {
    const input = registerPushSchema.parse(req.body);
    const result = await pushService.register(uid(req), input);
    sendOk(res, result);
  },

  async unregister(req: Request, res: Response) {
    const input = unregisterPushSchema.parse(req.body);
    const result = await pushService.unregister(uid(req), input.token);
    sendOk(res, result);
  },
};
