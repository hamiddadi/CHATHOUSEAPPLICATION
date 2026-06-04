import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  notifPrefsService,
  type NotifPrefs,
  type UpdateNotifPrefsInput,
} from '../services/notifPrefsService';

export const notifPrefsKeys = {
  all: ['notifPrefs'] as const,
};

export const useNotifPrefs = () =>
  useQuery<NotifPrefs>({
    queryKey: notifPrefsKeys.all,
    queryFn: () => notifPrefsService.get(),
  });

export const useUpdateNotifPrefs = () => {
  const qc = useQueryClient();
  return useMutation<NotifPrefs, Error, UpdateNotifPrefsInput, { previous?: NotifPrefs }>({
    mutationFn: (input: UpdateNotifPrefsInput) => notifPrefsService.update(input),
    // Optimistic: flip the switch immediately so the UI feels instant, then
    // reconcile with the server response on success. A single PATCH only ever
    // carries one key, but merging the whole partial keeps this correct if a
    // caller ever batches several.
    onMutate: async input => {
      await qc.cancelQueries({ queryKey: notifPrefsKeys.all });
      const previous = qc.getQueryData<NotifPrefs>(notifPrefsKeys.all);
      if (previous) {
        qc.setQueryData<NotifPrefs>(notifPrefsKeys.all, { ...previous, ...input });
      }
      return { previous };
    },
    onError: (_err, _input, context) => {
      // Roll back to the pre-mutation snapshot so the toggle reverts.
      if (context?.previous) {
        qc.setQueryData<NotifPrefs>(notifPrefsKeys.all, context.previous);
      }
    },
    onSuccess: updated => {
      qc.setQueryData<NotifPrefs>(notifPrefsKeys.all, updated);
    },
  });
};
