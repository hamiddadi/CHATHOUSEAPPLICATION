import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import {
  groupService,
  type GroupConversation,
  type GroupMessage,
  type GroupMessagePage,
} from '../services/groupService';
import type { ContentReportReason } from '../../../shared/types/moderation';
import { createIdempotencyKey } from '../../../shared/utils/idempotency';
import { retryTransientMutation } from '../../../shared/services/api/retryPolicy';

export const groupKeys = {
  all: ['groups'] as const,
  list: () => [...groupKeys.all, 'list'] as const,
  detail: (id: string) => [...groupKeys.all, 'detail', id] as const,
  messages: (id: string) => [...groupKeys.all, 'messages', id] as const,
};

// Matches the backend default (groups.schema listGroupMessagesSchema limit=30).
// Pagination ends only when the backend returns `nextCursor: null`.
export const GROUP_MESSAGES_PAGE_SIZE = 30;

/** Cache shape of a paginated thread: pages of ascending messages, page 0 = newest. */
type GroupMessagesCache = InfiniteData<GroupMessagePage, string | undefined>;

export const useGroups = () =>
  useQuery<GroupConversation[]>({
    queryKey: groupKeys.list(),
    queryFn: () => groupService.list(),
  });

export const useGroup = (id: string) =>
  useQuery<GroupConversation>({
    queryKey: groupKeys.detail(id),
    queryFn: () => groupService.detail(id),
    enabled: id.length > 0,
  });

/**
 * Cursor-paginated group thread history. Page 0 holds the latest messages;
 * each `fetchNextPage` loads strictly OLDER ones via the opaque `nextCursor`
 * returned by the previous page. `select` flattens the pages back into one
 * chronological GroupMessage[].
 */
export const useGroupMessages = (id: string) =>
  useInfiniteQuery({
    queryKey: groupKeys.messages(id),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      groupService.messages(id, { before: pageParam, limit: GROUP_MESSAGES_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    // The backend owns the total-order boundary and explicitly signals the end.
    getNextPageParam: (lastPage: GroupMessagePage) => lastPage.nextCursor ?? undefined,
    select: (data: GroupMessagesCache) => [...data.pages].reverse().flatMap(page => page.items),
    enabled: id.length > 0,
  });

// Append a just-sent message to the newest page (page 0 = latest chunk, each
// page ascending), so the flattened thread stays chronological.
const appendToGroupThread = (qc: QueryClient, message: GroupMessage): void => {
  qc.setQueryData<GroupMessagesCache>(groupKeys.messages(message.conversationId), prev =>
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

export const useSendGroupMessage = () => {
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
    }) => groupService.send(conversationId, text, idempotencyKey),
    retry: retryTransientMutation,
    onSuccess: message => {
      appendToGroupThread(qc, message);
      void qc.invalidateQueries({ queryKey: groupKeys.list() });
    },
  });
  type Variables = { conversationId: string; text: string };
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

export const useSendGroupVoice = () => {
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
    }) => groupService.sendVoice(conversationId, audioUrl, durationMs, idempotencyKey),
    retry: retryTransientMutation,
    onSuccess: message => {
      appendToGroupThread(qc, message);
      void qc.invalidateQueries({ queryKey: groupKeys.list() });
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

export const useReportGroupMessage = () =>
  useMutation({
    mutationFn: ({
      conversationId,
      messageId,
      reason,
    }: {
      conversationId: string;
      messageId: string;
      reason: ContentReportReason;
    }) => groupService.reportMessage(conversationId, messageId, reason),
  });

export const useCreateGroup = () => {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({
      memberIds,
      title,
      idempotencyKey,
    }: {
      memberIds: string[];
      title?: string;
      idempotencyKey: string;
    }) => groupService.create(memberIds, title, idempotencyKey),
    retry: retryTransientMutation,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: groupKeys.list() });
    },
  });
  type Variables = { memberIds: string[]; title?: string };
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

export const useMarkGroupRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => groupService.markAsRead(conversationId),
    onSuccess: (_res, conversationId) => {
      // Invalidate the detail too so `useGroup().unreadCount` (read by the open
      // thread + group-info screens) clears, not just the conversation list.
      void qc.invalidateQueries({ queryKey: groupKeys.detail(conversationId) });
      void qc.invalidateQueries({ queryKey: groupKeys.list() });
    },
  });
};

// Invalidate both the affected group's detail and the list after a membership
// or metadata change so every surface (info screen + conversation list) refreshes.
const invalidateGroup = (qc: ReturnType<typeof useQueryClient>, id: string) => {
  void qc.invalidateQueries({ queryKey: groupKeys.detail(id) });
  void qc.invalidateQueries({ queryKey: groupKeys.list() });
};

export const useRenameGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, title }: { conversationId: string; title: string }) =>
      groupService.rename(conversationId, title),
    onSuccess: (_g, { conversationId }) => invalidateGroup(qc, conversationId),
  });
};

export const useAddGroupMembers = () => {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({
      conversationId,
      userIds,
      idempotencyKey,
    }: {
      conversationId: string;
      userIds: string[];
      idempotencyKey: string;
    }) => groupService.addMembers(conversationId, userIds, idempotencyKey),
    retry: retryTransientMutation,
    onSuccess: (_g, { conversationId }) => invalidateGroup(qc, conversationId),
  });
  type Variables = { conversationId: string; userIds: string[] };
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

export const useRemoveGroupMember = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, userId }: { conversationId: string; userId: string }) =>
      groupService.removeMember(conversationId, userId),
    onSuccess: (_g, { conversationId }) => invalidateGroup(qc, conversationId),
  });
};

export const useLeaveGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => groupService.leave(conversationId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: groupKeys.list() });
    },
  });
};
