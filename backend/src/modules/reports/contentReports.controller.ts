import type { Request, Response } from 'express';
import { AppError } from '../../middlewares/error.middleware';
import { authedUserId } from '../../utils/authedUserId';
import { sendOk } from '../../utils/response';
import { contentReportSchema } from './contentReports.schema';
import { contentReportsService } from './contentReports.service';

const param = (req: Request, name: string): string => {
  const raw = req.params[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) throw new AppError('REPORT_002');
  return value;
};

export const contentReportsController = {
  async directMessage(req: Request, res: Response) {
    const result = await contentReportsService.reportDirectMessage(
      authedUserId(req),
      param(req, 'messageId'),
      contentReportSchema.parse(req.body),
    );
    sendOk(res, result, 201);
  },

  async groupMessage(req: Request, res: Response) {
    const result = await contentReportsService.reportGroupMessage(
      authedUserId(req),
      param(req, 'id'),
      param(req, 'messageId'),
      contentReportSchema.parse(req.body),
    );
    sendOk(res, result, 201);
  },

  async roomMessage(req: Request, res: Response) {
    const result = await contentReportsService.reportRoomMessage(
      authedUserId(req),
      param(req, 'id'),
      param(req, 'messageId'),
      contentReportSchema.parse(req.body),
    );
    sendOk(res, result, 201);
  },
};
