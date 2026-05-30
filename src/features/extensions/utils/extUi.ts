/**
 * Small shared UI helpers for the extensions feature components.
 *
 * - `initialOf` derives the single uppercase initial used by avatar / icon
 *   fallbacks across the extension strips and sheets.
 * - `apiErrorMessage` + `ApiError` centralise the "dig the message out of the
 *   nested API error envelope, else fall back" idiom used by the inline
 *   add/invite forms.
 */

/** Shape of the nested error message returned by the API client. */
export type ApiError = { response?: { data?: { error?: { message?: string } } } };

/**
 * Returns the uppercase first character of `name`, used for avatar / icon
 * fallbacks. When `name` is `null`/`undefined` it falls back to `'?'`, matching
 * the previous inline `(name ?? '?').slice(0, 1).toUpperCase()` idiom (an empty
 * string stays empty, exactly as before).
 */
export const initialOf = (name?: string | null): string => (name ?? '?').slice(0, 1).toUpperCase();

/**
 * Extracts the server-provided message from the nested API error envelope
 * (`err.response.data.error.message`), falling back to `fallback` when it is
 * absent or `err` does not match the expected shape.
 */
export const apiErrorMessage = (err: unknown, fallback: string): string =>
  (err as ApiError)?.response?.data?.error?.message ?? fallback;
