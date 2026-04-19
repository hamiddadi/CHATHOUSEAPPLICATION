import type { AxiosInstance } from 'axios';
import { tokenStorage } from '../../../features/auth/services/tokenStorage';
import { toAppError } from './errorHandler';

export interface InterceptorHandlers {
  /** Called whenever the backend returns a 401 so the app can clear auth. */
  onUnauthenticated?: () => void | Promise<void>;
}

/** Registers Bearer token injection + error normalization on an axios instance. */
export const attachInterceptors = (
  client: AxiosInstance,
  handlers: InterceptorHandlers = {},
): void => {
  client.interceptors.request.use(async config => {
    const session = await tokenStorage.get();
    if (session?.accessToken) {
      config.headers.set('Authorization', `Bearer ${session.accessToken}`);
    }
    return config;
  });

  client.interceptors.response.use(
    response => response,
    async error => {
      const appError = toAppError(error);
      if (appError.kind === 'auth') {
        await tokenStorage.clear();
        await handlers.onUnauthenticated?.();
      }
      return Promise.reject(appError);
    },
  );
};
