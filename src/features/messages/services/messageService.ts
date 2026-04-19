import {
  MOCK_CONVERSATIONS,
  findConversationById,
  findMessagesByConversationId,
} from '../../../shared/mocks/conversations.mock';
import { CURRENT_USER } from '../../../shared/mocks/users.mock';
import type { Conversation, Message } from '../../../shared/types/domain';

const wait = (ms: number): Promise<void> => new Promise(res => setTimeout(res, ms));

export const messageService = {
  async conversations(): Promise<Conversation[]> {
    await wait(200);
    return [...MOCK_CONVERSATIONS];
  },

  async conversation(id: string): Promise<Conversation> {
    await wait(150);
    const convo = findConversationById(id);
    if (!convo) throw new Error(`Conversation ${id} not found`);
    return convo;
  },

  async messages(conversationId: string): Promise<Message[]> {
    await wait(200);
    return [...findMessagesByConversationId(conversationId)];
  },

  async send(conversationId: string, text: string): Promise<Message> {
    await wait(150);
    const trimmed = text.trim();
    if (trimmed.length === 0) throw new Error('Message cannot be empty');
    if (!findConversationById(conversationId)) {
      throw new Error(`Conversation ${conversationId} not found`);
    }
    return {
      id: `m-new-${Date.now()}`,
      conversationId,
      authorId: CURRENT_USER.id,
      text: trimmed,
      sentAt: new Date().toISOString(),
      isMine: true,
    };
  },

  async markAsRead(conversationId: string): Promise<{ read: true }> {
    await wait(80);
    if (!findConversationById(conversationId)) {
      throw new Error(`Conversation ${conversationId} not found`);
    }
    return { read: true };
  },
};
