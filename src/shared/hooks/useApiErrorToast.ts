import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppError } from '../services/api/errorHandler';
import { toAppError } from '../services/api/errorHandler';
import { toast } from '../components/Toast';

/**
 * `handle(err)` — turn any thrown error (axios, AppError, generic) into a
 * localized toast. `auth` errors are silent here because the interceptor
 * already triggers signOut; surfacing a toast on top feels spammy.
 */
export const useApiErrorToast = (): ((err: unknown) => AppError) => {
  const { t } = useTranslation();
  return useCallback(
    (err: unknown) => {
      const e = toAppError(err);
      if (e.kind !== 'auth') {
        // Prefer the backend's message (e.g. rich 422 validation errors) when
        // present, otherwise fall back to the localized generic for this kind.
        const localized = e.message || t(`errorMessages.${e.kind}`);
        toast.error(localized);
      }
      return e;
    },
    [t],
  );
};
