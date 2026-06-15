import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  profileService,
  type ProfileViewer,
  type UpdateProfileInput,
} from '../services/profileService';
import type { User } from '../../../shared/types/domain';

export const profileKeys = {
  all: ['profile'] as const,
  me: () => [...profileKeys.all, 'me'] as const,
  detail: (id: string) => [...profileKeys.all, 'detail', id] as const,
  followers: (id: string) => [...profileKeys.all, 'followers', id] as const,
  following: (id: string) => [...profileKeys.all, 'following', id] as const,
  search: (q: string) => [...profileKeys.all, 'search', q] as const,
  viewers: () => [...profileKeys.all, 'viewers'] as const,
};

/** #76: who viewed my profile — premium (403s for non-premium; no retry). */
export const useProfileViewers = (enabled: boolean) =>
  useQuery<ProfileViewer[]>({
    queryKey: profileKeys.viewers(),
    queryFn: () => profileService.profileViewers(),
    enabled,
    retry: false,
    staleTime: 60_000,
  });

export const useMe = () =>
  useQuery<User>({ queryKey: profileKeys.me(), queryFn: () => profileService.me() });

export const useProfile = (userId: string) =>
  useQuery<User>({
    queryKey: profileKeys.detail(userId),
    queryFn: () => profileService.get(userId),
    enabled: userId.length > 0,
  });

export const useUpdateProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => profileService.update(input),
    onSuccess: updated => {
      qc.setQueryData(profileKeys.me(), updated);
    },
  });
};

export const useFollow = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => profileService.follow(userId),
    onSuccess: (_data, userId) => {
      void qc.invalidateQueries({ queryKey: profileKeys.detail(userId) });
      // Refreshing the whole `profile` tree also covers the viewer's `me`
      // (followingCount) and the followers/following lists shown on
      // FollowersScreen — these depend on the action but aren't keyed by
      // the target id, so detail(userId) alone would leave them stale.
      void qc.invalidateQueries({ queryKey: profileKeys.all });
    },
    onError: (_err, userId) => {
      // On failure, re-sync against the server so any optimistic UI reverts
      // instead of staying stuck in the new state. Callers surface their
      // own user-facing feedback (e.g. Alert).
      void qc.invalidateQueries({ queryKey: profileKeys.detail(userId) });
    },
  });
};

export const useUnfollow = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => profileService.unfollow(userId),
    onSuccess: (_data, userId) => {
      void qc.invalidateQueries({ queryKey: profileKeys.detail(userId) });
      void qc.invalidateQueries({ queryKey: profileKeys.all });
    },
    onError: (_err, userId) => {
      void qc.invalidateQueries({ queryKey: profileKeys.detail(userId) });
    },
  });
};

export const useFollowers = (userId: string) =>
  useQuery<User[]>({
    queryKey: profileKeys.followers(userId),
    queryFn: () => profileService.followers(userId),
    enabled: userId.length > 0,
  });

export const useFollowing = (userId: string) =>
  useQuery<User[]>({
    queryKey: profileKeys.following(userId),
    queryFn: () => profileService.following(userId),
    enabled: userId.length > 0,
  });

export const useSearchUsers = (query: string) =>
  useQuery<User[]>({
    queryKey: profileKeys.search(query),
    queryFn: () => profileService.search(query),
    // Don't fire on an empty query — there are no results to show and the
    // backend rejects empty q. Callers render `data ?? []` → empty list.
    enabled: query.trim().length > 0,
    staleTime: 1000 * 10,
  });
