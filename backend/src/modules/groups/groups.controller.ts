import type { Request, Response } from 'express';
import { sendOk } from '../../utils/response';
import { AppError } from '../../middlewares/error.middleware';
import { authedUserId } from '../../utils/authedUserId';
import {
  addGroupMembersSchema,
  createGroupSchema,
  listGroupMessagesSchema,
  sendGroupMessageSchema,
} from './groups.schema';
import { groupsService } from './groups.service';

const paramId = (req: Request, key: string): string => {
  const raw = req.params[key];
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id) throw new AppError('GROUP_001');
  return id;
};

export const groupsController = {
  async create(req: Request, res: Response) {
    const input = createGroupSchema.parse(req.body);
    const group = await groupsService.create(authedUserId(req), input);
    sendOk(res, group, 201);
  },

  async list(req: Request, res: Response) {
    const groups = await groupsService.list(authedUserId(req));
    sendOk(res, groups);
  },

  async detail(req: Request, res: Response) {
    const group = await groupsService.detail(authedUserId(req), paramId(req, 'id'));
    sendOk(res, group);
  },

  async messages(req: Request, res: Response) {
    const input = listGroupMessagesSchema.parse(req.query);
    const messages = await groupsService.listMessages(authedUserId(req), paramId(req, 'id'), input);
    sendOk(res, messages);
  },

  async send(req: Request, res: Response) {
    const input = sendGroupMessageSchema.parse(req.body);
    const message = await groupsService.send(authedUserId(req), paramId(req, 'id'), input);
    sendOk(res, message, 201);
  },

  async markRead(req: Request, res: Response) {
    const result = await groupsService.markRead(authedUserId(req), paramId(req, 'id'));
    sendOk(res, result);
  },

  async addMembers(req: Request, res: Response) {
    const input = addGroupMembersSchema.parse(req.body);
    const group = await groupsService.addMembers(authedUserId(req), paramId(req, 'id'), input);
    sendOk(res, group);
  },

  async leave(req: Request, res: Response) {
    const result = await groupsService.leave(authedUserId(req), paramId(req, 'id'));
    sendOk(res, result);
  },
};
