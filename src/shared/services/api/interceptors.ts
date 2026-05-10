import type {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from 'axios';
import { tokenStorage } from '../../../features/auth/services/tokenStorage';
import type { AuthSession } from '../../../features/auth/types/auth.types';
// Imported from the dependency-free state module to avoid the cycle
// apiClient → interceptors → impersonationStore → adminService → apiClient.
import { getImpersonationToken } from '../../../features/admin/store/impersonationState';
import { toAppError, type AppError } from './errorHandler';

export interface InterceptorHandlers {
  /** Called after a failed refresh, so the app can transition to the auth flow. */
  onUnauthenticated?: () => void | Promise<void>;
}

// Guard against the internal retry spinning if `/auth/refresh` itself 401s.
interface RetriableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

/**
 * Swallows refresh requests into a single in-flight promise so N concurrent
 * API calls that all 401 don't trigger N refreshes (thundering-herd).
 */
let refreshing: Promise<AuthSession | null> | null = null;

const performRefresh = async (client: AxiosInstance): Promise<AuthSession | null> => {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const current = await tokenStorage.get();
      if (!current?.refreshToken) return null;
      const res = await client.post<{
        success: true;
        data: { accessToken: string; refreshToken: string };
      }>(
        '/auth/refresh',
        { refreshToken: current.refreshToken },
        // `X-Skip-Auth` stops the request interceptor from re-injecting the
        // (now-invalid) access token during the refresh call itself.
        { headers: { 'X-Skip-Auth': '1' } },
      );
      const next: AuthSession = {
        accessToken: res.data.data.accessToken,
        refreshToken: res.data.data.refreshToken,
        // Backend contract is a 15-min access token; tokenStorage expects a
        // rough expiresAt — not used for validation, only for UI hints.
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      };
      await tokenStorage.set(next);
      return next;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
};

/** Registers Bearer injection + 401 → silent refresh → retry; error normalization. */
export const attachInterceptors = (
  client: AxiosInstance,
  handlers: InterceptorHandlers = {},
): void => {
  client.interceptors.request.use(async config => {
    if (config.headers.get('X-Skip-Auth') === '1') {
      config.headers.delete('X-Skip-Auth');
      return config;
    }
    // Impersonation override: when an active impersonation token is set,
    // it replaces the super-admin's own bearer for *this* request only.
    // Admin endpoints under /admin/* skip the override so the actual
    // super-admin keeps moderation powers in another tab/screen — the
    // impersonation surface should only act as the target user.
    const url = config.url ?? '';
    const isAdminCall = url.startsWith('/admin') || url.includes('/api/admin');
    const impToken = !isAdminCall ? getImpersonationToken() : null;
    if (impToken) {
      config.headers.set('Authorization', `Bearer ${impToken}`);
      return config;
    }
    const session = await tokenStorage.get();
    if (session?.accessToken) {
      config.headers.set('Authorization', `Bearer ${session.accessToken}`);
    }
    return config;
  });

  client.interceptors.response.use(
    response => response,
    async (error: AxiosError) => {
      const original = error.config as RetriableConfig | undefined;
      const appError: AppError = toAppError(error);

      const isAuthFailure = appError.kind === 'auth';
      const isRefreshCall = original?.url?.includes('/auth/refresh') ?? false;
      const alreadyRetried = original?._retry === true;

      // Try ONE silent refresh on a genuine 401, then replay the original
      // request. Skip for the refresh call itself and for retries.
      if (isAuthFailure && original && !alreadyRetried && !isRefreshCall) {
        const newSession = await performRefresh(client);
        if (newSession) {
          original._retry = true;
          original.headers.set('Authorization', `Bearer ${newSession.accessToken}`);
          return client.request(original as AxiosRequestConfig);
        }
      }

      if (isAuthFailure) {
        await tokenStorage.clear();
        await handlers.onUnauthenticated?.();
      }
      return Promise.reject(appError);
    },
  );
};
