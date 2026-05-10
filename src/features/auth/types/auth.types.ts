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
  createdAt: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}
