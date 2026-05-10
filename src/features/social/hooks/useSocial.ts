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
      // The blocked user's isFollowedByMe state is now false in both
      // directions; refetch their profile card + the blocked list.
      void qc.invalidateQueries({ queryKey: profileKeys.detail(userId) });
      void qc.invalidateQueries({ queryKey: socialKeys.blocked() });
    },
  });
};

export const useUnblock = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => socialService.unblock(userId),
    onSuccess: () => {
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
