import { apiClient } from '../../../shared/services/api/apiClient';

export interface InviteLink {
  /** Fully-qualified, shareable invite URL (encodes + signs the inviter). */
  url: string;
  /** The signed attribution code embedded in the URL. */
  code: string;
  /** How many invites the user has left (quota consumed on redemption). */
  remaining: number;
}

/** Result of redeeming an invite code (mirrors the backend RedeemResult). */
export type RedeemResult =
  | { attributed: true; inviterId: string }
  | { attributed: false; reason: 'invalid' | 'self' | 'already' | 'quota' };

export const invitesApi = {
  /**
   * Fetch the authenticated user's personal invite link + remaining quota. The
   * URL embeds + signs the inviter so attribution works at redemption time —
   * no client state needed.
   */
  async getLink(): Promise<InviteLink> {
    const { data } = await apiClient.get<InviteLink>('/ext/invites/link');
    return data;
  },

  /**
   * Attribute the authenticated (freshly onboarded) user to the inviter encoded
   * in `code`, consuming one of the inviter's invites. Always resolves with a
   * structured result; callers may ignore failures (signup proceeds regardless).
   */
  async redeem(code: string): Promise<RedeemResult> {
    const { data } = await apiClient.post<RedeemResult>('/ext/invites/redeem', { code });
    return data;
  },
};
