import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { groupService, type GroupConversation, type GroupMessage } from '../services/groupService';

export const groupKeys = {
  all: ['groups'] as const,
  list: () => [...groupKeys.all, 'list'] as const,
  detail: (id: string) => [...groupKeys.all, 'detail', id] as const,
  messages: (id: string) => [...groupKeys.all, 'messages', id] as const,
};

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

export const useGroupMessages = (id: string) =>
  useQuery<GroupMessage[]>({
    queryKey: groupKeys.messages(id),
    queryFn: () => groupService.messages(id),
    enabled: id.length > 0,
  });

export const useSendGroupMessage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, text }: { conversationId: string; text: string }) =>
      groupService.send(conversationId, text),
    onSuccess: message => {
      qc.setQueryData<GroupMessage[]>(groupKeys.messages(message.conversationId), prev =>
        prev ? [...prev, message] : [message],
      );
      void qc.invalidateQueries({ queryKey: groupKeys.list() });
    },
  });
};

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
    onSuccess: () => {
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
