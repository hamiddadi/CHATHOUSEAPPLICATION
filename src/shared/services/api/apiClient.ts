import axios from 'axios';
import { env } from '../../../config/env';
import { attachInterceptors, type InterceptorHandlers } from './interceptors';

const DEFAULT_TIMEOUT_MS = 15_000;

export const apiClient = axios.create({
  baseURL: env.API_BASE_URL,
  timeout: DEFAULT_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
});

/**
 * Wire auth-aware interceptors. Call once at app startup (inside AuthProvider
 * after hydration) so the client knows how to react to 401s.
 */
export const initApiClient = (handlers: InterceptorHandlers = {}): void => {
  attachInterceptors(apiClient, handlers);
};

export type { AppError } from './errorHandler';
