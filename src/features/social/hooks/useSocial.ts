import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { socialService, type ReportInput } from '../services/socialService';
import { profileKeys } from '../../profile/hooks/useProfile';
import type { UserSummary } from '../../../shared/types/domain';

export const socialKeys = {
  all: ['social'] as const,
  blocked: () => [...socialKeys.all, 'blocked'] as const,
};

export const useWave = () =>
  useMutation({
    mutationFn: (userId: string) => socialService.wave(userId),
  });

export const useBlock = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => socialService.block(userId),
    onSuccess: (_d, userId) => {
      // Blocking deletes the follow edge in BOTH directions server-side, so the
      // viewer's own follower/following counts + any rendered follow lists
      // change too — invalidate the whole profile namespace (mirrors useFollow),
      // plus the blocked list.
      void qc.invalidateQueries({ queryKey: profileKeys.detail(userId) });
      void qc.invalidateQueries({ queryKey: profileKeys.all });
      void qc.invalidateQueries({ queryKey: socialKeys.blocked() });
    },
  });
};

export const useUnblock = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => socialService.unblock(userId),
    onSuccess: (_d, userId) => {
      // Refresh the unblocked user's profile card (block badge / follow state)
      // in addition to the blocked list.
      void qc.invalidateQueries({ queryKey: profileKeys.detail(userId) });
      void qc.invalidateQueries({ queryKey: socialKeys.blocked() });
    },
  });
};

export const useBlockedUsers = () =>
  useQuery<UserSummary[]>({
    queryKey: socialKeys.blocked(),
    queryFn: () => socialService.listBlocked(),
  });

export const useReport = () =>
  useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: ReportInput }) =>
      socialService.report(userId, input),
  });
