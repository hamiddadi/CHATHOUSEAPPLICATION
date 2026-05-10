import type { Request, Response } from 'express';
import { sendOk } from '../../utils/response';
import { AppError } from '../../middlewares/error.middleware';
import { authService } from './auth.service';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
} from './auth.schema';

export const authController = {
  async register(req: Request, res: Response) {
    const input = registerSchema.parse(req.body);
    const result = await authService.register(input);
    sendOk(res, result, 201);
  },

  async login(req: Request, res: Response) {
    const input = loginSchema.parse(req.body);
    const result = await authService.login(input);
    sendOk(res, result);
  },

  async refresh(req: Request, res: Response) {
    const input = refreshSchema.parse(req.body);
    const result = await authService.refresh(input.refreshToken);
    sendOk(res, result);
  },

  async logout(req: Request, res: Response) {
    if (!req.userId || !req.accessToken) throw new AppError('AUTH_003');
    await authService.logout(req.userId, req.accessToken);
    sendOk(res, { loggedOut: true });
  },

  async forgotPassword(req: Request, res: Response) {
    const input = forgotPasswordSchema.parse(req.body);
    const result = await authService.forgotPassword(input);
    sendOk(res, result);
  },

  async resetPassword(req: Request, res: Response) {
    const input = resetPasswordSchema.parse(req.body);
    const result = await authService.resetPassword(input);
    sendOk(res, result);
  },

  async devLogin(_req: Request, res: Response) {
    const result = await authService.devLogin();
    sendOk(res, result);
  },
};
