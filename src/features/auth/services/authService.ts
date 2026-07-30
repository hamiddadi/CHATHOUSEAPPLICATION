import { apiClient } from '../../../shared/services/api/apiClient';
import { legalDocumentVersion } from '../../../config/env';
import type { AuthSession, AuthUser, LegalAcceptancePayload } from '../types/auth.types';

/**
 * Live auth service wired to the Express backend (Module 1: Phone + OTP).
 * Response envelope is `{ success: true, data: T }` so every call reaches
 * into `.data.data` once axios unwraps the HTTP layer.
 */

interface SendOtpResponse {
  success: true;
  data: { sent: true; expiresIn: number };
}

interface VerifyOtpResponse {
  success: true;
  data: {
    session: AuthSession;
    user: AuthUser;
    isNewUser: boolean;
  };
}

// Backend /users/me payload — the authoritative "me" shape. Individual
// endpoints (setUsername, setInterests, completeOnboarding) all return
// this same select, so we can reuse one mapper.
interface RawMe {
  id: string;
  username: string | null;
  email?: string | null;
  phoneNumber?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  interests?: string[];
  hasCompletedOnboarding?: boolean;
  termsAcceptedVersion?: string | null;
  termsAcceptedAt?: string | null;
  privacyNoticeAcknowledgedVersion?: string | null;
  privacyNoticeAcknowledgedAt?: string | null;
  legalAcceptanceLocale?: string | null;
  legalDocumentVersion?: string;
  legalAcceptanceRequired?: boolean;
  createdAt?: string;
}

interface MeEnvelope {
  success: true;
  data: RawMe;
}

interface CheckUsernameResponse {
  success: true;
  data: { available: boolean };
}

const mapUser = (raw: RawMe): AuthUser => ({
  id: raw.id,
  username: raw.username ?? '',
  displayName: raw.displayName ?? raw.username ?? '',
  phoneNumber: raw.phoneNumber ?? '',
  avatarUrl: raw.avatarUrl ?? null,
  bio: raw.bio ?? null,
  interests: raw.interests ?? [],
  hasCompletedOnboarding: raw.hasCompletedOnboarding ?? false,
  termsAcceptedVersion: raw.termsAcceptedVersion ?? null,
  termsAcceptedAt: raw.termsAcceptedAt ?? null,
  privacyNoticeAcknowledgedVersion: raw.privacyNoticeAcknowledgedVersion ?? null,
  privacyNoticeAcknowledgedAt: raw.privacyNoticeAcknowledgedAt ?? null,
  legalAcceptanceLocale: raw.legalAcceptanceLocale ?? null,
  legalDocumentVersion: raw.legalDocumentVersion ?? legalDocumentVersion,
  legalAcceptanceRequired:
    raw.legalAcceptanceRequired ??
    (raw.termsAcceptedVersion !== legalDocumentVersion ||
      raw.privacyNoticeAcknowledgedVersion !== legalDocumentVersion),
  createdAt: raw.createdAt ?? new Date().toISOString(),
});

export const authService = {
  async requestOtp(
    phoneNumber: string,
    legalAcceptance: LegalAcceptancePayload,
  ): Promise<{ sent: true; expiresIn: number }> {
    const res = await apiClient.post<SendOtpResponse>('/auth/send-otp', {
      phoneNumber,
      ageConfirmed: true,
      ...legalAcceptance,
    });
    return res.data.data;
  },

  async verifyOtp(
    phoneNumber: string,
    code: string,
    legalAcceptance: LegalAcceptancePayload,
  ): Promise<{ session: AuthSession; user: AuthUser; isNewUser: boolean }> {
    const res = await apiClient.post<VerifyOtpResponse>('/auth/verify-otp', {
      phoneNumber,
      code,
      ageConfirmed: true,
      ...legalAcceptance,
    });
    return res.data.data;
  },

  /**
   * Dev-only: the backend endpoint refuses when NODE_ENV=production.
   * Returns the same shape as verifyOtp so the auth store can reuse
   * its normal "session established" code path. The backend response
   * is a flat `{ user, accessToken, refreshToken, isNewUser }` (not
   * nested under `session`) — this maps it back into the app's shape.
   */
  async devLogin(): Promise<{ session: AuthSession; user: AuthUser; isNewUser: boolean }> {
    interface DevLoginResponse {
      success: true;
      data: {
        user: RawMe;
        accessToken: string;
        refreshToken: string;
        isNewUser: boolean;
      };
    }
    const res = await apiClient.post<DevLoginResponse>('/auth/dev-login');
    const { user, accessToken, refreshToken, isNewUser } = res.data.data;
    // Backend's access-token TTL is 15 min (JWT_ACCESS_TTL). The
    // `expiresAt` on AuthSession is a client-side hint used by the
    // refresh-before-expiry logic; mirroring the TTL is enough.
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    return {
      user: mapUser(user),
      isNewUser,
      session: { accessToken, refreshToken, expiresAt },
    };
  },

  async checkUsername(username: string): Promise<{ available: boolean }> {
    const res = await apiClient.get<CheckUsernameResponse>('/users/check-username', {
      params: { q: username },
    });
    return res.data.data;
  },

  async suggestUsername(): Promise<{ suggestions: string[] }> {
    const res = await apiClient.get<{ success: true; data: { suggestions: string[] } }>(
      '/users/suggest-username',
    );
    return res.data.data;
  },

  async setUsername(username: string): Promise<{ user: AuthUser }> {
    const res = await apiClient.patch<MeEnvelope>('/users/me/username', { username });
    return { user: mapUser(res.data.data) };
  },

  async getMe(): Promise<AuthUser> {
    const res = await apiClient.get<MeEnvelope>('/users/me');
    return mapUser(res.data.data);
  },

  async acceptLegalDocuments(
    legalAcceptance: LegalAcceptancePayload,
  ): Promise<
    Pick<
      AuthUser,
      | 'termsAcceptedVersion'
      | 'termsAcceptedAt'
      | 'privacyNoticeAcknowledgedVersion'
      | 'privacyNoticeAcknowledgedAt'
      | 'legalAcceptanceLocale'
      | 'legalDocumentVersion'
      | 'legalAcceptanceRequired'
    >
  > {
    const res = await apiClient.post<{
      success: true;
      data: RawMe;
    }>('/auth/legal-acceptance', legalAcceptance);
    const accepted = res.data.data;
    return {
      termsAcceptedVersion: accepted.termsAcceptedVersion ?? null,
      termsAcceptedAt: accepted.termsAcceptedAt ?? null,
      privacyNoticeAcknowledgedVersion: accepted.privacyNoticeAcknowledgedVersion ?? null,
      privacyNoticeAcknowledgedAt: accepted.privacyNoticeAcknowledgedAt ?? null,
      legalAcceptanceLocale: accepted.legalAcceptanceLocale ?? null,
      legalDocumentVersion: accepted.legalDocumentVersion ?? legalDocumentVersion,
      legalAcceptanceRequired:
        accepted.legalAcceptanceRequired ??
        (accepted.termsAcceptedVersion !== legalDocumentVersion ||
          accepted.privacyNoticeAcknowledgedVersion !== legalDocumentVersion),
    };
  },

  async setInterests(interests: string[]): Promise<{ user: AuthUser }> {
    const res = await apiClient.patch<MeEnvelope>('/users/me/interests', { interests });
    return { user: mapUser(res.data.data) };
  },

  async completeOnboarding(input: {
    displayName?: string;
    firstName?: string;
    lastName?: string;
    bio?: string;
    avatarUrl?: string | null;
    interests?: string[];
  }): Promise<{ user: AuthUser }> {
    const res = await apiClient.patch<MeEnvelope>('/users/me/onboarding', input);
    return { user: mapUser(res.data.data) };
  },

  async signOut(): Promise<void> {
    // Best-effort: we ignore the response since tokens are cleared locally
    // either way. 401/auth errors are already handled by the interceptor.
    await apiClient.post('/auth/logout').catch(() => undefined);
  },
};
