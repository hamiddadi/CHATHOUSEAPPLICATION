import type { Server, Socket } from 'socket.io';
import { chatService } from '../../modules/chat/chat.service';
import { logger } from '../../config/logger';
import { userChannel } from '../channels';
import { getUserId } from '../socket.middleware';

interface SendPayload {
  receiverId: string;
  content: string;
}
interface TypingPayload {
  receiverId: string;
}
interface ReadPayload {
  messageId: string;
}

/**
 * Per-user channel model: each connected socket joins `user:<their-id>` on
 * connection so any other socket can target them directly. This avoids
 * having to maintain a userId → socketId map and scales through the Redis
 * adapter.
 */
export const registerChatHandlers = (io: Server, socket: Socket): void => {
  const me = (): string => getUserId(socket);
  void socket.join(userChannel(me()));

  socket.on('chat:send', async (payload: SendPayload, ack?: (ok: boolean) => void) => {
    try {
      // chatService.send now emits `chat:message` to both parties itself
      // (so the REST path is covered too) — don't double-emit here.
      await chatService.send(me(), payload.receiverId, { content: payload.content });
      ack?.(true);
    } catch (err) {
      logger.warn('chat:send failed', { err });
      ack?.(false);
    }
  });

  socket.on('chat:typing', (payload: TypingPayload) => {
    io.to(userChannel(payload.receiverId)).emit('chat:typing', { senderId: me() });
  });

  socket.on('chat:read', async (payload: ReadPayload, ack?: (ok: boolean) => void) => {
    try {
      // Validate the socket payload before hitting the service: an absent /
      // non-string messageId would otherwise reach Prisma as
      // `where: { id: undefined }`.
      if (typeof payload?.messageId !== 'string' || !payload.messageId) {
        ack?.(false);
        return;
      }
      const msg = await chatService.markRead(me(), payload.messageId);
      io.to(userChannel(msg.senderId)).emit('chat:read', { messageId: msg.id });
      ack?.(true);
    } catch (err) {
      logger.warn('chat:read failed', { err });
      ack?.(false);
    }
  });
};
