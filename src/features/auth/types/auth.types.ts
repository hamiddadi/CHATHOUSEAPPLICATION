export type AuthStatus = 'idle' | 'authenticating' | 'authenticated' | 'unauthenticated';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  phoneNumber: string;
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
  createdAt: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface LegalAcceptancePayload {
  termsAccepted: true;
  privacyNoticeAcknowledged: true;
  legalDocumentVersion: string;
  legalLocale: string;
}
