import type { AxiosError } from 'axios';

// Inlined rather than imported from `axios` — `axios/lib/adapters/fetch.js`
// eagerly probes ReadableStream at load time, which crashes under jest-expo's
// stream polyfill. Duck-typing `err.isAxiosError` is functionally identical
// to axios's own helper.
const isAxiosError = (err: unknown): err is AxiosError =>
  typeof err === 'object' &&
  err !== null &&
  (err as { isAxiosError?: boolean }).isAxiosError === true;

/**
 * Normalized error shape propagated up to UI layers.
 * Keep the shape stable so components can switch on `kind` without string parsing.
 */
export interface AppError {
  kind:
    | 'network'
    | 'timeout'
    | 'auth'
    | 'forbidden'
    | 'notFound'
    | 'validation'
    | 'server'
    | 'unknown';
  status?: number;
  message: string;
  /** Field-level errors, filled by the backend on 422 validation failures. */
  fields?: Record<string, string>;
  /**
   * Sanitized cause, kept for logging but never shown to users. For Axios
   * errors this is a scrubbed summary (no request/response headers, so the
   * `Authorization: Bearer <token>` header and raw bodies never reach logs,
   * Sentry breadcrumbs, or any console.error that serializes an AppError).
   */
  cause?: unknown;
}

/**
 * Minimal, secret-free summary of an AxiosError safe to attach as `cause`.
 * Deliberately omits `err.config.headers` (Authorization token), `err.request`,
 * and raw response bodies that may carry sensitive data.
 */
interface SafeCause {
  code?: string;
  status?: number;
  method?: string;
  url?: string;
}

const safeCause = (err: AxiosError): SafeCause => ({
  code: err.code,
  status: err.response?.status,
  method: err.config?.method,
  url: err.config?.url,
});

const messageByKind: Record<AppError['kind'], string> = {
  network: "We couldn't reach the server. Check your connection.",
  timeout: 'The request took too long. Please try again.',
  auth: 'Your session expired. Please sign in again.',
  forbidden: "You don't have access to this resource.",
  notFound: 'Resource not found.',
  validation: 'Some fields need attention.',
  server: 'Something went wrong on our end.',
  unknown: 'Unexpected error.',
};

/**
 * An already-normalized AppError (a plain object with a string `kind` +
 * `message`). The axios response interceptor rejects with one of these, so
 * `toAppError` MUST be idempotent — otherwise re-normalizing it (it's neither
 * an AxiosError nor an `instanceof Error`) collapsed every error to
 * `kind:'unknown'`/"Unexpected error.", breaking every toast + form validation.
 */
const isAppError = (e: unknown): e is AppError =>
  typeof e === 'object' &&
  e !== null &&
  'kind' in e &&
  typeof (e as AppError).kind === 'string' &&
  'message' in e &&
  typeof (e as AppError).message === 'string';

export const toAppError = (err: unknown): AppError => {
  if (isAppError(err)) {
    return err;
  }
  if (isAxiosError(err)) {
    return fromAxios(err);
  }
  if (err instanceof Error) {
    return { kind: 'unknown', message: err.message, cause: err };
  }
  return { kind: 'unknown', message: messageByKind.unknown, cause: err };
};

/**
 * Flatten the backend's validation `details` (Zod `flatten().fieldErrors`,
 * shape `Record<string, string[]>`) into one message per field. Also tolerates
 * the legacy flat `Record<string, string>` shape. Returns undefined when empty.
 */
const flattenFieldErrors = (details: unknown): Record<string, string> | undefined => {
  if (!details || typeof details !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [field, val] of Object.entries(details as Record<string, unknown>)) {
    if (Array.isArray(val) && typeof val[0] === 'string') out[field] = val[0];
    else if (typeof val === 'string') out[field] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

const fromAxios = (err: AxiosError): AppError => {
  const cause = safeCause(err);
  if (err.code === 'ECONNABORTED') {
    return { kind: 'timeout', message: messageByKind.timeout, cause };
  }
  if (!err.response) {
    return { kind: 'network', message: messageByKind.network, cause };
  }

  const status = err.response.status;
  // Backend envelope: { success:false, error:{ code, message, details? } }.
  // Fall back to a flat { message, errors } shape for resilience.
  const body = err.response.data as
    | {
        error?: { code?: string; message?: string; details?: unknown };
        message?: string;
        errors?: unknown;
      }
    | undefined;
  const backendMessage = body?.error?.message ?? body?.message;
  const code = body?.error?.code;
  const fields = flattenFieldErrors(body?.error?.details ?? body?.errors);
  // Backend reports validation failures as 400 VALIDATION_001 (Zod), not 422.
  const isValidation =
    status === 422 || code === 'VALIDATION_001' || (status === 400 && fields !== undefined);

  if (status === 401)
    return { kind: 'auth', status, message: backendMessage ?? messageByKind.auth, cause };
  if (status === 403)
    return { kind: 'forbidden', status, message: backendMessage ?? messageByKind.forbidden, cause };
  if (status === 404)
    return { kind: 'notFound', status, message: backendMessage ?? messageByKind.notFound, cause };
  if (isValidation) {
    return {
      kind: 'validation',
      status,
      message: backendMessage ?? messageByKind.validation,
      fields,
      cause,
    };
  }
  if (status >= 500) {
    return { kind: 'server', status, message: backendMessage ?? messageByKind.server, cause };
  }
  return { kind: 'unknown', status, message: backendMessage ?? messageByKind.unknown, cause };
};
