import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  notifPrefsExtApi,
  type FrequencyTier,
  type NotifPrefsExt,
} from '../../extensions/api/notifPrefsExtApi';

/**
 * Extended notification preferences (notifPrefsExt) — frequency tier plus
 * per-club / per-user push mutes. Lives alongside the boolean per-type
 * toggles (`useNotifPrefs`) but is backed by the Redis-stored extension
 * service, so it has its own query key and mutations.
 */
export const notifPrefsExtKeys = {
  all: ['notifPrefsExt'] as const,
};

export const useNotifPrefsExt = () =>
  useQuery<NotifPrefsExt>({
    queryKey: notifPrefsExtKeys.all,
    queryFn: () => notifPrefsExtApi.get(),
  });

type SetFreqResult = { frequency: FrequencyTier };
type ExtCtx = { previous?: NotifPrefsExt };

export const useSetNotifFrequency = () => {
  const qc = useQueryClient();
  return useMutation<SetFreqResult, Error, FrequencyTier, ExtCtx>({
    mutationFn: (frequency: FrequencyTier) => notifPrefsExtApi.setFrequency(frequency),
    // Optimistic: reflect the new tier immediately, roll back on error.
    onMutate: async frequency => {
      await qc.cancelQueries({ queryKey: notifPrefsExtKeys.all });
      const previous = qc.getQueryData<NotifPrefsExt>(notifPrefsExtKeys.all);
      if (previous) {
        qc.setQueryData<NotifPrefsExt>(notifPrefsExtKeys.all, { ...previous, frequency });
      }
      return { previous };
    },
    onError: (_err, _frequency, context) => {
      if (context?.previous) {
        qc.setQueryData<NotifPrefsExt>(notifPrefsExtKeys.all, context.previous);
      }
    },
  });
};

export const useToggleMutedClub = () => {
  const qc = useQueryClient();
  return useMutation<void, Error, { clubId: string; muted: boolean }, ExtCtx>({
    mutationFn: ({ clubId, muted }) =>
      muted ? notifPrefsExtApi.muteClub(clubId) : notifPrefsExtApi.unmuteClub(clubId),
    onMutate: async ({ clubId, muted }) => {
      await qc.cancelQueries({ queryKey: notifPrefsExtKeys.all });
      const previous = qc.getQueryData<NotifPrefsExt>(notifPrefsExtKeys.all);
      if (previous) {
        const mutedClubs = muted
          ? Array.from(new Set([...previous.mutedClubs, clubId]))
          : previous.mutedClubs.filter(id => id !== clubId);
        qc.setQueryData<NotifPrefsExt>(notifPrefsExtKeys.all, { ...previous, mutedClubs });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData<NotifPrefsExt>(notifPrefsExtKeys.all, context.previous);
      }
    },
  });
};

export const useUnmuteUser = () => {
  const qc = useQueryClient();
  return useMutation<void, Error, string, ExtCtx>({
    mutationFn: (userId: string) => notifPrefsExtApi.unmuteUser(userId),
    onMutate: async userId => {
      await qc.cancelQueries({ queryKey: notifPrefsExtKeys.all });
      const previous = qc.getQueryData<NotifPrefsExt>(notifPrefsExtKeys.all);
      if (previous) {
        qc.setQueryData<NotifPrefsExt>(notifPrefsExtKeys.all, {
          ...previous,
          mutedUsers: previous.mutedUsers.filter(id => id !== userId),
        });
      }
      return { previous };
    },
    onError: (_err, _userId, context) => {
      if (context?.previous) {
        qc.setQueryData<NotifPrefsExt>(notifPrefsExtKeys.all, context.previous);
      }
    },
  });
};
