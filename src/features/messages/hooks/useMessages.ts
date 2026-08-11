import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { messageService } from '../services/messageService';
import type { ConversationPage, MessagePage } from '../services/messageService';
import type { Conversation, Message } from '../../../shared/types/domain';
import type { ContentReportReason } from '../../../shared/types/moderation';
import { createIdempotencyKey } from '../../../shared/utils/idempotency';
import { retryTransientMutation } from '../../../shared/services/api/retryPolicy';

export const messageKeys = {
  all: ['messages'] as const,
  conversations: () => [...messageKeys.all, 'conversations'] as const,
  conversation: (id: string) => [...messageKeys.all, 'conversation', id] as const,
  messages: (id: string) => [...messageKeys.all, 'messages', id] as const,
  unread: () => [...messageKeys.all, 'unread'] as const,
};

// Matches the backend default (chat.schema listMessagesSchema limit=30).
// Pagination ends only when the backend returns `nextCursor: null`.
export const MESSAGES_PAGE_SIZE = 30;

/** Cache shape of a paginated thread: pages of ascending messages, page 0 = newest. */
type MessagesCache = InfiniteData<MessagePage, string | undefined>;
type ConversationsCache = InfiniteData<ConversationPage, string | undefined>;

export const useUnreadMessageCount = () =>
  useQuery<number>({
    queryKey: messageKeys.unread(),
    queryFn: () => messageService.unreadCount(),
    staleTime: 30_000,
  });

export const useConversations = () =>
  useInfiniteQuery({
    queryKey: messageKeys.conversations(),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      messageService.conversations(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: ConversationPage) => lastPage.nextCursor ?? undefined,
    select: (data: ConversationsCache) => data.pages.flatMap(page => page.items),
  });

export const useConversation = (id: string) =>
  useQuery<Conversation>({
    queryKey: messageKeys.conversation(id),
    queryFn: () => messageService.conversation(id),
    enabled: id.length > 0,
  });

/**
 * Cursor-paginated thread history. Page 0 holds the latest messages; each
 * `fetchNextPage` loads strictly OLDER ones via the opaque `nextCursor` returned
 * by the previous page. `select` flattens the pages back into one chronological
 * Message[] so consumers keep the plain shape.
 */
export const useConversationMessages = (id: string) =>
  useInfiniteQuery({
    queryKey: messageKeys.messages(id),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      messageService.messages(id, { before: pageParam, limit: MESSAGES_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    // The backend owns the total-order boundary and explicitly signals the end.
    getNextPageParam: (lastPage: MessagePage) => lastPage.nextCursor ?? undefined,
    select: (data: MessagesCache) => [...data.pages].reverse().flatMap(page => page.items),
    enabled: id.length > 0,
  });

// Append a just-sent message to the newest page (page 0 = latest chunk, each
// page ascending), so the flattened thread stays chronological.
const appendToThread = (qc: QueryClient, message: Message): void => {
  qc.setQueryData<MessagesCache>(messageKeys.messages(message.conversationId), prev =>
    prev
      ? prev.pages.some(page => page.items.some(existing => existing.id === message.id))
        ? prev
        : {
            ...prev,
            pages: prev.pages.map((page, i) =>
              i === 0 ? { ...page, items: [...page.items, message] } : page,
            ),
          }
      : { pages: [{ items: [message], nextCursor: null }], pageParams: [undefined] },
  );
};

export const useSendMessage = () => {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({
      conversationId,
      text,
      idempotencyKey,
    }: {
      conversationId: string;
      text: string;
      idempotencyKey: string;
    }) => messageService.send(conversationId, text, idempotencyKey),
    retry: retryTransientMutation,
    onSuccess: message => {
      appendToThread(qc, message);
      void qc.invalidateQueries({ queryKey: messageKeys.conversations() });
    },
  });
  type Variables = { conversationId: string; text: string };
  const withKey = (variables: Variables) => ({
    ...variables,
    // This wrapper runs once per mutate/mutateAsync call. TanStack Query keeps
    // the resulting variables object for every transport retry, so all retries
    // carry the same key while a new user action receives a fresh one.
    idempotencyKey: createIdempotencyKey(),
  });
  return {
    ...mutation,
    mutate: (variables: Variables, options?: Parameters<typeof mutation.mutate>[1]) =>
      mutation.mutate(withKey(variables), options),
    mutateAsync: (variables: Variables, options?: Parameters<typeof mutation.mutateAsync>[1]) =>
      mutation.mutateAsync(withKey(variables), options),
  };
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
          ? {
              ...prev,
              pages: prev.pages.map(page => ({
                ...page,
                items: page.items.filter(message => message.id !== messageId),
              })),
            }
          : prev,
      );
      void qc.invalidateQueries({ queryKey: messageKeys.conversations() });
    },
  });
};

export const useReportMessage = () =>
  useMutation({
    mutationFn: ({ messageId, reason }: { messageId: string; reason: ContentReportReason }) =>
      messageService.report(messageId, reason),
  });

export const useSendVoiceMessage = () => {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({
      conversationId,
      audioUrl,
      durationMs,
      idempotencyKey,
    }: {
      conversationId: string;
      audioUrl: string;
      durationMs: number;
      idempotencyKey: string;
    }) => messageService.sendVoice(conversationId, audioUrl, durationMs, idempotencyKey),
    retry: retryTransientMutation,
    onSuccess: message => {
      appendToThread(qc, message);
      void qc.invalidateQueries({ queryKey: messageKeys.conversations() });
    },
  });
  type Variables = { conversationId: string; audioUrl: string; durationMs: number };
  const withKey = (variables: Variables) => ({
    ...variables,
    idempotencyKey: createIdempotencyKey(),
  });
  return {
    ...mutation,
    mutate: (variables: Variables, options?: Parameters<typeof mutation.mutate>[1]) =>
      mutation.mutate(withKey(variables), options),
    mutateAsync: (variables: Variables, options?: Parameters<typeof mutation.mutateAsync>[1]) =>
      mutation.mutateAsync(withKey(variables), options),
  };
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
