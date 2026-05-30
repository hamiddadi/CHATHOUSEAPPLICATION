import type { Request, Response } from 'express';
import { sendOk } from '../../utils/response';
import { AppError } from '../../middlewares/error.middleware';
import { authedUserId as requireUserId } from '../../utils/authedUserId';
import {
  completeOnboardingSchema,
  interestsSchema,
  locationSchema,
  notifPrefsSchema,
  searchQuerySchema,
  setUsernameSchema,
  updateMeSchema,
  usernameAvailabilitySchema,
  visibilitySchema,
} from './users.schema';
import { usersService } from './users.service';

export const usersController = {
  async getMe(req: Request, res: Response) {
    const me = await usersService.getMe(requireUserId(req));
    sendOk(res, me);
  },

  async updateMe(req: Request, res: Response) {
    const input = updateMeSchema.parse(req.body);
    const me = await usersService.updateMe(requireUserId(req), input);
    sendOk(res, me);
  },

  async setVisibility(req: Request, res: Response) {
    const input = visibilitySchema.parse(req.body);
    const result = await usersService.setVisibility(requireUserId(req), input);
    sendOk(res, result);
  },

  async setLocation(req: Request, res: Response) {
    const input = locationSchema.parse(req.body);
    const result = await usersService.setLocation(requireUserId(req), input);
    sendOk(res, result);
  },

  async onlineLocations(req: Request, res: Response) {
    const rows = await usersService.getOnlineLocations(requireUserId(req));
    sendOk(res, rows);
  },

  async getById(req: Request, res: Response) {
    const raw = req.params['id'];
    const id = Array.isArray(raw) ? raw[0] : raw;
    if (!id) throw new AppError('USER_001');
    const user = await usersService.getById(id, req.userId);
    sendOk(res, user);
  },

  async search(req: Request, res: Response) {
    const input = searchQuerySchema.parse(req.query);
    const rows = await usersService.search(input, req.userId);
    sendOk(res, rows);
  },

  async checkUsername(req: Request, res: Response) {
    const input = usernameAvailabilitySchema.parse(req.query);
    const result = await usersService.checkUsername(input);
    sendOk(res, result);
  },

  async setUsername(req: Request, res: Response) {
    const input = setUsernameSchema.parse(req.body);
    const result = await usersService.setUsername(requireUserId(req), input);
    sendOk(res, result);
  },

  async setInterests(req: Request, res: Response) {
    const input = interestsSchema.parse(req.body);
    const result = await usersService.setInterests(requireUserId(req), input);
    sendOk(res, result);
  },

  async completeOnboarding(req: Request, res: Response) {
    const input = completeOnboardingSchema.parse(req.body);
    const result = await usersService.completeOnboarding(requireUserId(req), input);
    sendOk(res, result);
  },

  async suggestUsername(req: Request, res: Response) {
    const raw = req.query['q'];
    const base = typeof raw === 'string' ? raw : '';
    const result = await usersService.suggestUsername(base);
    sendOk(res, result);
  },

  async requestDeletion(req: Request, res: Response) {
    const result = await usersService.requestDeletion(requireUserId(req));
    sendOk(res, result);
  },

  async cancelDeletion(req: Request, res: Response) {
    const result = await usersService.cancelDeletion(requireUserId(req));
    sendOk(res, result);
  },

  async getNotifPrefs(req: Request, res: Response) {
    const result = await usersService.getNotificationPreferences(requireUserId(req));
    sendOk(res, result);
  },

  async updateNotifPrefs(req: Request, res: Response) {
    const input = notifPrefsSchema.parse(req.body);
    const result = await usersService.updateNotificationPreferences(requireUserId(req), input);
    sendOk(res, result);
  },

  /**
   * GDPR data export. Streams the JSON archive as a downloadable file
   * so mobile clients can hand it off via the Share sheet without
   * loading it through the React Query cache.
   */
  async exportData(req: Request, res: Response) {
    const data = await usersService.exportData(requireUserId(req));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="chathouse-export-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    res.send(JSON.stringify(data, null, 2));
  },
};
