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
  /** Raw cause, kept for logging but never shown to users. */
  cause?: unknown;
}

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
  if (err.code === 'ECONNABORTED') {
    return { kind: 'timeout', message: messageByKind.timeout, cause: err };
  }
  if (!err.response) {
    return { kind: 'network', message: messageByKind.network, cause: err };
  }

  const status = err.response.status;
  const data = err.response.data as
    | { message?: string; errors?: Record<string, string> }
    | undefined;

  if (status === 401) return { kind: 'auth', status, message: messageByKind.auth, cause: err };
  if (status === 403)
    return { kind: 'forbidden', status, message: messageByKind.forbidden, cause: err };
  if (status === 404)
    return { kind: 'notFound', status, message: messageByKind.notFound, cause: err };
  if (status === 422) {
    return {
      kind: 'validation',
      status,
      message: data?.message ?? messageByKind.validation,
      fields: data?.errors,
      cause: err,
    };
  }
  if (status >= 500) {
    return { kind: 'server', status, message: messageByKind.server, cause: err };
  }

  return {
    kind: 'unknown',
    status,
    message: data?.message ?? messageByKind.unknown,
    cause: err,
  };
};
