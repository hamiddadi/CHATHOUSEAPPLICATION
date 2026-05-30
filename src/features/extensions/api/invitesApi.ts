import { apiClient } from '../../../shared/services/api/apiClient';

export interface InviteLink {
  /** Fully-qualified, shareable invite URL (encodes the inviter). */
  url: string;
  /** The opaque attribution code embedded in the URL. */
  code: string;
}

export const invitesApi = {
  /**
   * Fetch the authenticated user's personal invite link. The URL embeds the
   * inviter so attribution works at redemption time — no client state needed.
   */
  async getLink(): Promise<InviteLink> {
    const { data } = await apiClient.get<InviteLink>('/ext/invites/link');
    return data;
  },
};
