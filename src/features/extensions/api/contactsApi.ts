import { apiClient } from '../../../shared/services/api/apiClient';

export interface ContactMatch {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  followerCount: number;
}

export const contactsApi = {
  /**
   * Send raw E.164 numbers (over TLS) to be matched against registered users.
   * The previous salted-hash scheme was removed: the shared salt was
   * enumerable, so it protected nothing. Numbers are never persisted server-side.
   */
  async match(phoneNumbers: string[]): Promise<ContactMatch[]> {
    const { data } = await apiClient.post<{ matches: ContactMatch[] }>('/ext/contacts/match', {
      phoneNumbers,
    });
    return data.matches;
  },
};
