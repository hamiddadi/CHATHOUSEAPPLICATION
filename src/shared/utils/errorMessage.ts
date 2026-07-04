import { i18n } from '../../core/i18n';
import { isAppError } from '../services/api/errorHandler';

/**
 * Extracts a human-readable message from an unknown caught value, falling back
 * to `fallback`. Replaces the repeated `e instanceof Error ? e.message : '…'`
 * idiom scattered across screens/Alerts.
 *
 * Handles the plain-object `AppError`s rejected by the axios interceptors
 * (they are NOT `instanceof Error`): when the backend supplied a stable error
 * code (e.g. `CLUB_006`), it resolves the dedicated translation
 * `errors.codes.<CODE>`, defaulting to the AppError's own message.
 */
export const errorMessage = (e: unknown, fallback = 'Une erreur est survenue'): string => {
  if (isAppError(e)) {
    if (e.code) return i18n.t(`errors.codes.${e.code}`, e.message || fallback);
    return e.message || fallback;
  }
  return e instanceof Error ? e.message : fallback;
};
