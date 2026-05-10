import { tokenStorage } from './tokenStorage';

jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      delete store[k];
    }),
  };
});

describe('tokenStorage', () => {
  const session = {
    accessToken: 'at-abc',
    refreshToken: 'rt-xyz',
    expiresAt: '2030-01-01T00:00:00.000Z',
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

  it('clear removes the key', async () => {
    await tokenStorage.set(session);
    await tokenStorage.clear();
    expect(await tokenStorage.get()).toBeNull();
  });

  it('returns null on malformed JSON (does not throw)', async () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const mocked = require('expo-secure-store') as {
      getItemAsync: jest.Mock;
    };
    /* eslint-enable @typescript-eslint/no-require-imports */
    mocked.getItemAsync.mockResolvedValueOnce('not-json');
    expect(await tokenStorage.get()).toBeNull();
  });
});
