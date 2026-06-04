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

// Backend contract: access tokens live ~15 min. Used only for a rough
// `expiresAt` UI hint in tokenStorage, not for validation.
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;

// Guard against the internal retry spinning if `/auth/refresh` itself 401s.
interface RetriableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

/**
 * Swallows refresh requests into a single in-flight promise so N concurrent
 * API calls that all 401 don't trigger N refreshes (thundering-herd).
 */
let refreshing: Promise<AuthSession | null> | null = null;

// Guard so the auth teardown (clear tokens + onUnauthenticated) runs at most
// once per session. Without it, (a) several requests that all 401 after the
// access token expires each fire signOut → /auth/logout, and (b) the tokenless
// /auth/logout POST itself 401s and re-enters this interceptor → another
// teardown → another /auth/logout → unbounded recursion. The isAuthEndpoint
// check below is the primary fix; this flag is defense-in-depth for concurrent
// 401s.
let teardownInProgress = false;

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
        // tokenStorage expects a rough expiresAt — not used for validation,
        // only for UI hints. See ACCESS_TOKEN_TTL_MS above.
        expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString(),
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
    // Admin endpoints skip the override so the actual super-admin keeps
    // moderation powers — the impersonation surface should only act as the
    // target user.
    //
    // Intent is expressed explicitly via the `X-Skip-Impersonation` header
    // (set by adminService), which is robust regardless of how `config.url`
    // is built. We keep a hardened URL fallback (normalized regex tolerating
    // a missing leading slash and an optional `/api` prefix) so callers that
    // predate the header still bypass impersonation correctly.
    const skipImpersonationHeader = config.headers.get('X-Skip-Impersonation') === '1';
    if (skipImpersonationHeader) config.headers.delete('X-Skip-Impersonation');
    const url = config.url ?? '';
    const isAdminUrl = /^\/?(?:api\/)?admin(?:\/|$|\?)/.test(url);
    const skipImpersonation = skipImpersonationHeader || isAdminUrl;
    const impToken = !skipImpersonation ? getImpersonationToken() : null;
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
      const url = original?.url ?? '';
      // Never run refresh OR teardown for the auth endpoints themselves:
      //  - /auth/refresh: a 401 there is handled by performRefresh returning null.
      //  - /auth/logout: it's best-effort and runs AFTER tokens are cleared, so
      //    its tokenless 401 must NOT re-trigger teardown — that caused an
      //    unbounded logout → 401 → logout recursion flooding the server.
      const isAuthEndpoint = url.includes('/auth/refresh') || url.includes('/auth/logout');
      const alreadyRetried = original?._retry === true;

      // Try ONE silent refresh on a genuine 401, then replay the original
      // request. Skip for the auth endpoints and for retries.
      if (isAuthFailure && original && !alreadyRetried && !isAuthEndpoint) {
        const newSession = await performRefresh(client);
        if (newSession) {
          original._retry = true;
          original.headers.set('Authorization', `Bearer ${newSession.accessToken}`);
          return client.request(original as AxiosRequestConfig);
        }
      }

      // Refresh failed (or wasn't possible): tear the session down ONCE.
      if (isAuthFailure && !isAuthEndpoint && !teardownInProgress) {
        teardownInProgress = true;
        try {
          await tokenStorage.clear();
          await handlers.onUnauthenticated?.();
        } finally {
          teardownInProgress = false;
        }
      }
      return Promise.reject(appError);
    },
  );
};
