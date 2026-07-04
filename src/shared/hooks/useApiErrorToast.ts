import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppError } from '../services/api/errorHandler';
import { messageByKind, toAppError } from '../services/api/errorHandler';
import { toast } from '../components/Toast';

/**
 * Kinds whose `message` is generic plumbing (often raw English from the
 * backend or axios) — always show the localized generic for these instead.
 * Specific kinds (validation, forbidden…) keep the backend's richer message.
 */
const GENERIC_KINDS: ReadonlySet<AppError['kind']> = new Set([
  'network',
  'timeout',
  'server',
  'unknown',
  'rateLimited',
]);

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
        // Priority: 1) dedicated translation for the backend code when one
        // exists (errors.codes.<CODE>), 2) localized generic for generic
        // kinds, 3) the backend's specific message (e.g. rich validation
        // errors) with the localized generic as last resort.
        const generic = messageByKind(e.kind);
        const base = GENERIC_KINDS.has(e.kind) ? generic : e.message || generic;
        const localized =
          e.code && e.kind !== 'validation' ? t(`errors.codes.${e.code}`, base) : base;
        toast.error(localized);
      }
      return e;
    },
    [t],
  );
};
