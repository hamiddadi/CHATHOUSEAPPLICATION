import type { Request, Response } from 'express';
import { sendOk } from '../../utils/response';
import { sendOtpSchema, verifyOtpSchema } from './otp.schema';
import { otpService } from './otp.service';

export const otpController = {
  async send(req: Request, res: Response) {
    const input = sendOtpSchema.parse(req.body);
    const result = await otpService.send(input);
    sendOk(res, result);
  },

  async verify(req: Request, res: Response) {
    const input = verifyOtpSchema.parse(req.body);
    const result = await otpService.verify(input);
    sendOk(res, result);
  },
};
