import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { messageService } from '../services/messageService';
import type { Conversation, Message } from '../../../shared/types/domain';

export const messageKeys = {
  all: ['messages'] as const,
  conversations: () => [...messageKeys.all, 'conversations'] as const,
  conversation: (id: string) => [...messageKeys.all, 'conversation', id] as const,
  messages: (id: string) => [...messageKeys.all, 'messages', id] as const,
  unread: () => [...messageKeys.all, 'unread'] as const,
};

// Matches the backend default (chat.schema listMessagesSchema limit=30). A
// short page (< PAGE_SIZE) means the start of the history was reached.
export const MESSAGES_PAGE_SIZE = 30;

/** Cache shape of a paginated thread: pages of ascending messages, page 0 = newest. */
type MessagesCache = InfiniteData<Message[], string | undefined>;

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

/**
 * Cursor-paginated thread history. Page 0 holds the latest messages; each
 * `fetchNextPage` loads strictly OLDER ones via the `before` cursor (the ISO
 * `sentAt` of the oldest message loaded so far). `select` flattens the pages
 * back into one chronological Message[] so consumers keep the plain shape.
 */
export const useConversationMessages = (id: string) =>
  useInfiniteQuery({
    queryKey: messageKeys.messages(id),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      messageService.messages(id, { before: pageParam, limit: MESSAGES_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    // A full page means older history may remain; its first (oldest) message
    // becomes the next cursor. A short page ends the scroll.
    getNextPageParam: (lastPage: Message[]) =>
      lastPage.length === MESSAGES_PAGE_SIZE ? lastPage[0]?.sentAt : undefined,
    select: (data: MessagesCache) => [...data.pages].reverse().flat(),
    enabled: id.length > 0,
  });

// Append a just-sent message to the newest page (page 0 = latest chunk, each
// page ascending), so the flattened thread stays chronological.
const appendToThread = (qc: QueryClient, message: Message): void => {
  qc.setQueryData<MessagesCache>(messageKeys.messages(message.conversationId), prev =>
    prev
      ? { ...prev, pages: prev.pages.map((page, i) => (i === 0 ? [...page, message] : page)) }
      : { pages: [[message]], pageParams: [undefined] },
  );
};

export const useSendMessage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, text }: { conversationId: string; text: string }) =>
      messageService.send(conversationId, text),
    onSuccess: message => {
      appendToThread(qc, message);
      void qc.invalidateQueries({ queryKey: messageKeys.conversations() });
    },
  });
};

export const useDeleteMessage = () => {
  const qc = useQueryClient();
  return useMutation({
    // Backend allows sender-only deletion (DELETE /chat/messages/:id). We pass
    // the conversationId alongside so the optimistic cache prune targets the
    // right thread without an extra lookup.
    mutationFn: ({ messageId }: { messageId: string; conversationId: string }) =>
      messageService.remove(messageId),
    onSuccess: (_res, { messageId, conversationId }) => {
      qc.setQueryData<MessagesCache>(messageKeys.messages(conversationId), prev =>
        prev
          ? { ...prev, pages: prev.pages.map(page => page.filter(m => m.id !== messageId)) }
          : prev,
      );
      void qc.invalidateQueries({ queryKey: messageKeys.conversations() });
    },
  });
};

export const useSendVoiceMessage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      audioUrl,
      durationMs,
    }: {
      conversationId: string;
      audioUrl: string;
      durationMs: number;
    }) => messageService.sendVoice(conversationId, audioUrl, durationMs),
    onSuccess: message => {
      appendToThread(qc, message);
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
