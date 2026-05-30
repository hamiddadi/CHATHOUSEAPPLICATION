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

export const toAppError = (err: unknown): AppError => {
  if (isAxiosError(err)) {
    return fromAxios(err);
  }
  if (err instanceof Error) {
    return { kind: 'unknown', message: err.message, cause: err };
  }
  return { kind: 'unknown', message: messageByKind.unknown, cause: err };
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
  const data = err.response.data as
    | { message?: string; errors?: Record<string, string> }
    | undefined;

  if (status === 401) return { kind: 'auth', status, message: messageByKind.auth, cause };
  if (status === 403) return { kind: 'forbidden', status, message: messageByKind.forbidden, cause };
  if (status === 404) return { kind: 'notFound', status, message: messageByKind.notFound, cause };
  if (status === 422) {
    return {
      kind: 'validation',
      status,
      message: data?.message ?? messageByKind.validation,
      fields: data?.errors,
      cause,
    };
  }
  if (status >= 500) {
    return { kind: 'server', status, message: messageByKind.server, cause };
  }

  return {
    kind: 'unknown',
    status,
    message: data?.message ?? messageByKind.unknown,
    cause,
  };
};
