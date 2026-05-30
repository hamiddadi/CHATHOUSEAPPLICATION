import type { Request, Response } from 'express';
import { sendOk } from '../../utils/response';
import { AppError } from '../../middlewares/error.middleware';
import { listMessagesSchema, sendMessageSchema } from './chat.schema';
import { chatService } from './chat.service';

const requireUserId = (req: Request): string => {
  if (!req.userId) throw new AppError('AUTH_003');
  return req.userId;
};

const paramId = (req: Request, key: string, errorCode: 'CHAT_002' | 'USER_001') => {
  const raw = req.params[key];
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id) throw new AppError(errorCode);
  return id;
};

export const chatController = {
  async conversations(req: Request, res: Response) {
    const userId = requireUserId(req);
    const limitRaw = req.query['limit'];
    const cursorRaw = req.query['cursor'];
    const hasPaging = limitRaw !== undefined || cursorRaw !== undefined;
    // Default high so the unpaginated mobile call still returns every
    // conversation in the scan window (no silent 30-row truncation).
    const limit =
      typeof limitRaw === 'string' ? Math.min(100, Math.max(1, Number(limitRaw) || 30)) : 500;
    const cursor = typeof cursorRaw === 'string' ? cursorRaw : undefined;
    const result = await chatService.listConversations(userId, limit, cursor);
    // Back-compat: existing clients expect a bare array. Opt into the
    // paginated { data, nextCursor, hasMore } envelope via ?limit/?cursor.
    sendOk(res, hasPaging ? result : result.data);
  },

  async conversationWithPeer(req: Request, res: Response) {
    const result = await chatService.conversationWith(
      requireUserId(req),
      paramId(req, 'peerId', 'USER_001'),
    );
    sendOk(res, result);
  },

  async withPeer(req: Request, res: Response) {
    const input = listMessagesSchema.parse(req.query);
    const rows = await chatService.listWithPeer(
      requireUserId(req),
      paramId(req, 'userId', 'USER_001'),
      input,
    );
    sendOk(res, rows);
  },

  async send(req: Request, res: Response) {
    const input = sendMessageSchema.parse(req.body);
    const msg = await chatService.send(
      requireUserId(req),
      paramId(req, 'userId', 'USER_001'),
      input,
    );
    sendOk(res, msg, 201);
  },

  async markRead(req: Request, res: Response) {
    const msg = await chatService.markRead(
      requireUserId(req),
      paramId(req, 'messageId', 'CHAT_002'),
    );
    sendOk(res, msg);
  },

  async markReadWithPeer(req: Request, res: Response) {
    const result = await chatService.markReadWithPeer(
      requireUserId(req),
      paramId(req, 'userId', 'USER_001'),
    );
    sendOk(res, result);
  },

  async unreadCount(req: Request, res: Response) {
    const result = await chatService.unreadCount(requireUserId(req));
    sendOk(res, result);
  },

  async remove(req: Request, res: Response) {
    const result = await chatService.remove(
      requireUserId(req),
      paramId(req, 'messageId', 'CHAT_002'),
    );
    sendOk(res, result);
  },
};
