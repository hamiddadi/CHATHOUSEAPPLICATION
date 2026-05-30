import type { Request, Response } from 'express';
import { sendOk } from '../../utils/response';
import { authedUserId as uid } from '../../utils/authedUserId';
import { registerPushSchema, unregisterPushSchema } from './push.schema';
import { pushService } from './push.service';

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
