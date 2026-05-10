import { useCallback } from 'react';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { toAppError } from '../services/api/errorHandler';
import { useApiErrorToast } from './useApiErrorToast';

/**
 * Bridges backend errors to a react-hook-form instance:
 *   - 422 with per-field errors → `setError(field, { message })`
 *   - Everything else → toast via `useApiErrorToast`
 *
 * Screens call `handle(err)` in their submit `catch`.
 */
export const useFormApiErrors = <T extends FieldValues>(
  setError: UseFormSetError<T>,
): ((err: unknown) => void) => {
  const toastError = useApiErrorToast();
  return useCallback(
    (err: unknown) => {
      const appError = toAppError(err);
      if (appError.kind === 'validation' && appError.fields) {
        for (const [field, message] of Object.entries(appError.fields)) {
          setError(field as Path<T>, { type: 'server', message });
        }
        return;
      }
      toastError(err);
    },
    [setError, toastError],
  );
};
