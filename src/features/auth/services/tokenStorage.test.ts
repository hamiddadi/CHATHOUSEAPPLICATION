import * as Keychain from 'react-native-keychain';
import { tokenStorage } from './tokenStorage';

jest.mock('react-native-keychain', () => {
  let stored: string | null = null;
  return {
    getGenericPassword: jest.fn(async () =>
      stored === null ? false : { username: 'chathouse', password: stored },
    ),
    setGenericPassword: jest.fn(async (_username: string, password: string) => {
      stored = password;
      return { service: 'chathouse.auth.session.v1', storage: 'keychain' };
    }),
    resetGenericPassword: jest.fn(async () => {
      stored = null;
      return true;
    }),
  };
});

describe('tokenStorage', () => {
  const session = {
    accessToken: 'at-abc',
    refreshToken: 'rt-xyz',
    expiresAt: '2030-01-01T00:00:00.000Z',
    scope: 'active' as const,
  };

  afterEach(async () => {
    await tokenStorage.clear();
    jest.clearAllMocks();
  });

  it('returns null when nothing is stored', async () => {
    await tokenStorage.clear();
    expect(await tokenStorage.get()).toBeNull();
  });

  it('persists and reads back the session', async () => {
    await tokenStorage.set(session);
    expect(await tokenStorage.get()).toEqual(session);
  });

  it('treats a pre-scope persisted session as active during the rollout', async () => {
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValueOnce({
      username: 'chathouse',
      password: JSON.stringify({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
      }),
    });

    expect(await tokenStorage.get()).toEqual(session);
  });

  it('keeps a rotated session available in memory when Keychain persistence fails', async () => {
    const rotated = { ...session, accessToken: 'rotated-access' };
    (Keychain.setGenericPassword as jest.Mock).mockRejectedValueOnce(
      new Error('Keychain unavailable'),
    );

    await expect(tokenStorage.set(rotated)).rejects.toThrow('Keychain unavailable');
    expect(await tokenStorage.get()).toEqual(rotated);
  });

  it('clear removes the entry', async () => {
    await tokenStorage.set(session);
    await tokenStorage.clear();
    expect(await tokenStorage.get()).toBeNull();
  });

  it('tombstones the in-process session when native Keychain deletion fails', async () => {
    await tokenStorage.set(session);
    (Keychain.resetGenericPassword as jest.Mock).mockRejectedValueOnce(
      new Error('Keychain reset unavailable'),
    );

    await expect(tokenStorage.clear()).rejects.toThrow('Keychain reset unavailable');
    expect(await tokenStorage.get()).toBeNull();
  });

  it('returns null on malformed JSON (does not throw)', async () => {
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValueOnce({
      username: 'chathouse',
      password: 'not-json',
    });
    expect(await tokenStorage.get()).toBeNull();
  });

  it('returns null when stored JSON does not match the session contract', async () => {
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValueOnce({
      username: 'chathouse',
      password: JSON.stringify({ accessToken: 'at-abc', expiresAt: 'not-a-date' }),
    });
    expect(await tokenStorage.get()).toBeNull();
  });
});
