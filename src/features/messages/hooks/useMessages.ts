import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { messageService } from '../services/messageService';
import type { Conversation, Message } from '../../../shared/types/domain';

export const messageKeys = {
  all: ['messages'] as const,
  conversations: () => [...messageKeys.all, 'conversations'] as const,
  conversation: (id: string) => [...messageKeys.all, 'conversation', id] as const,
  messages: (id: string) => [...messageKeys.all, 'messages', id] as const,
  unread: () => [...messageKeys.all, 'unread'] as const,
};

export const useUnreadMessageCount = () =>
  useQuery<number>({
    queryKey: messageKeys.unread(),
    queryFn: () => messageService.unreadCount(),
    staleTime: 30_000,
  });

export const useConversations = () =>
  useQuery<Conversation[]>({
    queryKey: messageKeys.conversations(),
    queryFn: () => messageService.conversations(),
  });

export const useConversation = (id: string) =>
  useQuery<Conversation>({
    queryKey: messageKeys.conversation(id),
    queryFn: () => messageService.conversation(id),
    enabled: id.length > 0,
  });

export const useConversationMessages = (id: string) =>
  useQuery<Message[]>({
    queryKey: messageKeys.messages(id),
    queryFn: () => messageService.messages(id),
    enabled: id.length > 0,
  });

export const useSendMessage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, text }: { conversationId: string; text: string }) =>
      messageService.send(conversationId, text),
    onSuccess: message => {
      qc.setQueryData<Message[]>(messageKeys.messages(message.conversationId), prev =>
        prev ? [...prev, message] : [message],
      );
      void qc.invalidateQueries({ queryKey: messageKeys.conversations() });
    },
  });
};

export const useMarkConversationRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => messageService.markAsRead(conversationId),
    onSuccess: (_res, conversationId) => {
      void qc.invalidateQueries({ queryKey: messageKeys.conversations() });
      // The tab badge reads messageKeys.unread() — without this it stays lit.
      void qc.invalidateQueries({ queryKey: messageKeys.unread() });
      void qc.invalidateQueries({ queryKey: messageKeys.conversation(conversationId) });
    },
  });
};
