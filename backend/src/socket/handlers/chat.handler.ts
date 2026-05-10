import type { Server, Socket } from 'socket.io';
import { chatService } from '../../modules/chat/chat.service';
import { logger } from '../../config/logger';

const userChannel = (userId: string): string => `user:${userId}`;

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
  const me = (): string => socket.data.userId as string;
  void socket.join(userChannel(me()));

  socket.on('chat:send', async (payload: SendPayload, ack?: (ok: boolean) => void) => {
    try {
      const msg = await chatService.send(me(), payload.receiverId, { content: payload.content });
      // Emit to both the sender (for echo/UI confirmation) and the receiver.
      io.to(userChannel(me())).emit('chat:message', msg);
      io.to(userChannel(payload.receiverId)).emit('chat:message', msg);
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
      const msg = await chatService.markRead(me(), payload.messageId);
      io.to(userChannel(msg.senderId)).emit('chat:read', { messageId: msg.id });
      ack?.(true);
    } catch (err) {
      logger.warn('chat:read failed', { err });
      ack?.(false);
    }
  });
};
