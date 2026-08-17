export type AuthStatus =
  | 'idle'
  | 'authenticating'
  | 'authenticated'
  | 'restoration_required'
  | 'unauthenticated';

export type AccountState = 'ACTIVE' | 'PENDING_DELETION';

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
  accountState: AccountState;
  deletedAt: string | null;
  permanentDeletionAt: string | null;
  createdAt: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope: 'active' | 'account_recovery';
}

export interface LegalAcceptancePayload {
  termsAccepted: true;
  privacyNoticeAcknowledged: true;
  legalDocumentVersion: string;
  legalLocale: string;
}
