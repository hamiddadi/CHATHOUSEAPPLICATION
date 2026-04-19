import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { profileService, type UpdateProfileInput } from '../services/profileService';
import type { User } from '../../../shared/types/domain';

export const profileKeys = {
  all: ['profile'] as const,
  me: () => [...profileKeys.all, 'me'] as const,
  detail: (id: string) => [...profileKeys.all, 'detail', id] as const,
  followers: (id: string) => [...profileKeys.all, 'followers', id] as const,
  following: (id: string) => [...profileKeys.all, 'following', id] as const,
  search: (q: string) => [...profileKeys.all, 'search', q] as const,
};

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
    },
  });
};

export const useUnfollow = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => profileService.unfollow(userId),
    onSuccess: (_data, userId) => {
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
    staleTime: 1000 * 10,
  });
