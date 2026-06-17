import { apiClient } from '../../../shared/services/api/apiClient';

/**
 * Twitter / X profile import (server-side PKCE).
 *
 * The backend mints `state` + the PKCE verifier and returns only the
 * authorize `url` + `state` — the client holds no crypto. After the user
 * authorizes in the system browser and Twitter redirects to
 * `chathouse://oauth/twitter?code=…&state=…`, the client echoes `{ state, code }`
 * back to /complete and gets the imported profile fields.
 */

export interface TwitterProfile {
  name: string;
  username: string;
  bio: string | null;
  avatarUrl: string | null;
}

export const twitterApi = {
  async status(): Promise<{ configured: boolean }> {
    const { data } = await apiClient.get<{ configured: boolean }>('/ext/twitter/status');
    return data;
  },
  async begin(): Promise<{ url: string; state: string }> {
    const { data } = await apiClient.post<{ url: string; state: string }>('/ext/twitter/begin');
    return data;
  },
  async complete(state: string, code: string): Promise<TwitterProfile> {
    const { data } = await apiClient.post<TwitterProfile>('/ext/twitter/complete', { state, code });
    return data;
  },
};
