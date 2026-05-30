import type { Request, Response } from 'express';
import { sendOk } from '../../utils/response';
import { AppError } from '../../middlewares/error.middleware';
import { authedUserId as requireUserId } from '../../utils/authedUserId';
import {
  createClubSchema,
  inviteSchema,
  listClubsSchema,
  setMemberRoleSchema,
  updateClubSchema,
} from './clubs.schema';
import { clubsService } from './clubs.service';

const paramId = (req: Request, key: string): string => {
  const raw = req.params[key];
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id) throw new AppError('CLUB_001');
  return id;
};

export const clubsController = {
  async list(req: Request, res: Response) {
    const input = listClubsSchema.parse(req.query);
    const rows = await clubsService.list(requireUserId(req), input);
    sendOk(res, rows);
  },

  async create(req: Request, res: Response) {
    const input = createClubSchema.parse(req.body);
    const club = await clubsService.create(requireUserId(req), input);
    sendOk(res, club, 201);
  },

  async get(req: Request, res: Response) {
    const club = await clubsService.get(requireUserId(req), paramId(req, 'id'));
    sendOk(res, club);
  },

  async join(req: Request, res: Response) {
    const result = await clubsService.join(requireUserId(req), paramId(req, 'id'));
    sendOk(res, result);
  },

  async leave(req: Request, res: Response) {
    const result = await clubsService.leave(requireUserId(req), paramId(req, 'id'));
    sendOk(res, result);
  },

  async invite(req: Request, res: Response) {
    const input = inviteSchema.parse(req.body);
    const result = await clubsService.invite(requireUserId(req), paramId(req, 'id'), input.userIds);
    sendOk(res, result);
  },

  async accept(req: Request, res: Response) {
    const result = await clubsService.acceptInvitation(requireUserId(req), paramId(req, 'id'));
    sendOk(res, result);
  },

  async setMemberRole(req: Request, res: Response) {
    const input = setMemberRoleSchema.parse(req.body);
    const result = await clubsService.setMemberRole(
      requireUserId(req),
      paramId(req, 'id'),
      paramId(req, 'userId'),
      input.role,
    );
    sendOk(res, result);
  },

  async update(req: Request, res: Response) {
    const input = updateClubSchema.parse(req.body);
    const result = await clubsService.update(requireUserId(req), paramId(req, 'id'), input);
    sendOk(res, result);
  },

  async remove(req: Request, res: Response) {
    const result = await clubsService.remove(requireUserId(req), paramId(req, 'id'));
    sendOk(res, result);
  },
};
