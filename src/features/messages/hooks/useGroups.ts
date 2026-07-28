import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { groupService, type GroupConversation, type GroupMessage } from '../services/groupService';
import type { ContentReportReason } from '../../../shared/types/moderation';

export const groupKeys = {
  all: ['groups'] as const,
  list: () => [...groupKeys.all, 'list'] as const,
  detail: (id: string) => [...groupKeys.all, 'detail', id] as const,
  messages: (id: string) => [...groupKeys.all, 'messages', id] as const,
};

// Matches the backend default (groups.schema listGroupMessagesSchema limit=30).
// A short page (< PAGE_SIZE) means the start of the history was reached.
export const GROUP_MESSAGES_PAGE_SIZE = 30;

/** Cache shape of a paginated thread: pages of ascending messages, page 0 = newest. */
type GroupMessagesCache = InfiniteData<GroupMessage[], string | undefined>;

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
 * each `fetchNextPage` loads strictly OLDER ones via the `before` cursor (the
 * ISO `createdAt` of the oldest message loaded so far). `select` flattens the
 * pages back into one chronological GroupMessage[].
 */
export const useGroupMessages = (id: string) =>
  useInfiniteQuery({
    queryKey: groupKeys.messages(id),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      groupService.messages(id, { before: pageParam, limit: GROUP_MESSAGES_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    // A full page means older history may remain; its first (oldest) message
    // becomes the next cursor. A short page ends the scroll.
    getNextPageParam: (lastPage: GroupMessage[]) =>
      lastPage.length === GROUP_MESSAGES_PAGE_SIZE ? lastPage[0]?.createdAt : undefined,
    select: (data: GroupMessagesCache) => [...data.pages].reverse().flat(),
    enabled: id.length > 0,
  });

// Append a just-sent message to the newest page (page 0 = latest chunk, each
// page ascending), so the flattened thread stays chronological.
const appendToGroupThread = (qc: QueryClient, message: GroupMessage): void => {
  qc.setQueryData<GroupMessagesCache>(groupKeys.messages(message.conversationId), prev =>
    prev
      ? { ...prev, pages: prev.pages.map((page, i) => (i === 0 ? [...page, message] : page)) }
      : { pages: [[message]], pageParams: [undefined] },
  );
};

export const useSendGroupMessage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, text }: { conversationId: string; text: string }) =>
      groupService.send(conversationId, text),
    onSuccess: message => {
      appendToGroupThread(qc, message);
      void qc.invalidateQueries({ queryKey: groupKeys.list() });
    },
  });
};

export const useSendGroupVoice = () => {
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
    }) => groupService.sendVoice(conversationId, audioUrl, durationMs),
    onSuccess: message => {
      appendToGroupThread(qc, message);
      void qc.invalidateQueries({ queryKey: groupKeys.list() });
    },
  });
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
  return useMutation({
    mutationFn: ({ memberIds, title }: { memberIds: string[]; title?: string }) =>
      groupService.create(memberIds, title),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: groupKeys.list() });
    },
  });
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
  return useMutation({
    mutationFn: ({ conversationId, userIds }: { conversationId: string; userIds: string[] }) =>
      groupService.addMembers(conversationId, userIds),
    onSuccess: (_g, { conversationId }) => invalidateGroup(qc, conversationId),
  });
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
