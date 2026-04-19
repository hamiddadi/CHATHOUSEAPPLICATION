import type { AuthSession, AuthUser } from '../types/auth.types';

/**
 * Mock auth service.
 * Signatures match what the backend will return so wiring only needs
 * to swap the implementation, not the caller contracts.
 */

const wait = (ms: number) => new Promise(res => setTimeout(res, ms));

export const authService = {
  async requestOtp(phoneNumber: string): Promise<{ sent: true }> {
    await wait(600);
    if (!phoneNumber) throw new Error('Phone number is required');
    return { sent: true };
  },

  async verifyOtp(
    phoneNumber: string,
    code: string,
  ): Promise<{ session: AuthSession; user: AuthUser; isNewUser: boolean }> {
    await wait(600);
    if (code.length < 4) throw new Error('Invalid code');
    return {
      session: {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
      },
      user: {
        id: 'user-1',
        username: 'claude',
        displayName: 'Claude',
        phoneNumber,
        avatarUrl: null,
        bio: null,
        createdAt: new Date().toISOString(),
      },
      isNewUser: false,
    };
  },

  async setUsername(username: string): Promise<{ user: AuthUser }> {
    await wait(400);
    return {
      user: {
        id: 'user-1',
        username,
        displayName: username,
        phoneNumber: '',
        avatarUrl: null,
        bio: null,
        createdAt: new Date().toISOString(),
      },
    };
  },

  async signOut(): Promise<void> {
    await wait(100);
  },
};
