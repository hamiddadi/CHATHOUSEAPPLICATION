import type { Request, Response } from 'express';
import { sendOk } from '../../utils/response';
import { AppError } from '../../middlewares/error.middleware';
import { recordingsService } from './recordings.service';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export const recordingsController = {
  async recent(req: Request, res: Response) {
    const raw = req.query['limit'];
    const parsed = typeof raw === 'string' ? Number(raw) : NaN;
    const limit = Number.isFinite(parsed)
      ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsed)))
      : DEFAULT_LIMIT;
    const data = await recordingsService.listRecent(limit);
    sendOk(res, data);
  },

  async forRoom(req: Request, res: Response) {
    const raw = req.params['roomId'];
    const roomId = Array.isArray(raw) ? raw[0] : raw;
    if (!roomId) throw new AppError('ROOM_001');
    const data = await recordingsService.listForRoom(roomId);
    sendOk(res, data);
  },
};
