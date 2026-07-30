const previousLivekitEnv = {
  url: process.env.LIVEKIT_URL,
  internalUrl: process.env.LIVEKIT_INTERNAL_URL,
  apiKey: process.env.LIVEKIT_API_KEY,
  apiSecret: process.env.LIVEKIT_API_SECRET,
  ttl: process.env.LIVEKIT_TOKEN_TTL_SECONDS,
};

process.env.LIVEKIT_URL = 'wss://public.livekit.test';
process.env.LIVEKIT_INTERNAL_URL = 'http://livekit:7880';
process.env.LIVEKIT_API_KEY = 'test-key';
process.env.LIVEKIT_API_SECRET = 'test-secret';
// Legacy local value: env validation must accept it and clamp it to five
// minutes instead of preventing the service from starting.
process.env.LIVEKIT_TOKEN_TTL_SECONDS = '3600';

const mockHasCurrentLegalAcceptance = jest.fn().mockResolvedValue(true);
jest.mock('../src/modules/auth/legal-acceptance', () => ({
  hasCurrentLegalAcceptance: mockHasCurrentLegalAcceptance,
}));

jest.mock('livekit-server-sdk', () => {
  const state = {
    events: [] as string[],
    createError: undefined as unknown,
    createOptions: [] as Array<{ name: string }>,
    roomServiceHosts: [] as string[],
    tokenTtls: [] as string[],
    grants: [] as Array<Record<string, unknown>>,
  };

  class RoomServiceClient {
    constructor(host: string) {
      state.roomServiceHosts.push(host);
    }

    async createRoom(options: { name: string }) {
      state.events.push(`create:${options.name}`);
      state.createOptions.push(options);
      if (state.createError !== undefined) throw state.createError;
      return { name: options.name };
    }

    async removeParticipant(room: string, identity: string) {
      state.events.push(`remove:${room}:${identity}`);
    }

    async deleteRoom(room: string) {
      state.events.push(`delete:${room}`);
    }
  }

  class AccessToken {
    private room = '';

    constructor(_apiKey: string, _apiSecret: string, options: { identity: string; ttl: string }) {
      state.tokenTtls.push(options.ttl);
    }

    addGrant(grant: Record<string, unknown>) {
      this.room = String(grant.room);
      state.grants.push(grant);
    }

    async toJwt() {
      state.events.push(`sign:${this.room}`);
      return 'signed-livekit-token';
    }
  }

  return {
    __esModule: true,
    AccessToken,
    RoomServiceClient,
    __livekitMock: state,
  };
});

type LivekitMockState = {
  events: string[];
  createError: unknown;
  createOptions: Array<{ name: string }>;
  roomServiceHosts: string[];
  tokenTtls: string[];
  grants: Array<Record<string, unknown>>;
};

/* eslint-disable @typescript-eslint/no-require-imports */
const { env, LIVEKIT_TOKEN_MAX_TTL_SECONDS } =
  require('../src/config/env') as typeof import('../src/config/env');
const { livekitService } =
  require('../src/modules/rooms/livekit.service') as typeof import('../src/modules/rooms/livekit.service');
const { __livekitMock } = require('livekit-server-sdk') as {
  __livekitMock: LivekitMockState;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const restoreEnv = (name: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
};

beforeEach(() => {
  __livekitMock.events.length = 0;
  __livekitMock.createError = undefined;
  __livekitMock.createOptions.length = 0;
  __livekitMock.roomServiceHosts.length = 0;
  __livekitMock.tokenTtls.length = 0;
  __livekitMock.grants.length = 0;
});

afterAll(() => {
  restoreEnv('LIVEKIT_URL', previousLivekitEnv.url);
  restoreEnv('LIVEKIT_INTERNAL_URL', previousLivekitEnv.internalUrl);
  restoreEnv('LIVEKIT_API_KEY', previousLivekitEnv.apiKey);
  restoreEnv('LIVEKIT_API_SECRET', previousLivekitEnv.apiSecret);
  restoreEnv('LIVEKIT_TOKEN_TTL_SECONDS', previousLivekitEnv.ttl);
});

describe('livekitService room provisioning and token lifetime', () => {
  it('clamps a legacy 3600-second env value and creates the room before signing', async () => {
    expect(LIVEKIT_TOKEN_MAX_TTL_SECONDS).toBe(300);
    expect(env.LIVEKIT_TOKEN_TTL_SECONDS).toBe(300);

    const result = await livekitService.issueRoomToken({
      roomId: 'room-1',
      userId: 'user-1',
      role: 'LISTENER',
    });

    expect(__livekitMock.createOptions).toEqual([{ name: 'room-1' }]);
    expect(__livekitMock.roomServiceHosts).toEqual(['http://livekit:7880']);
    expect(__livekitMock.events).toEqual(['create:room-1', 'sign:room-1']);
    expect(__livekitMock.tokenTtls).toEqual(['300s']);
    expect(result).toEqual(
      expect.objectContaining({
        token: 'signed-livekit-token',
        url: 'wss://public.livekit.test',
        room: 'room-1',
        identity: 'user-1',
        canPublish: false,
        expiresInSec: 300,
      }),
    );
  });

  it('treats an already-existing room as the idempotent success path', async () => {
    __livekitMock.createError = Object.assign(new Error('room already exists'), {
      code: 'already_exists',
      status: 409,
    });

    await expect(
      livekitService.issueRoomToken({
        roomId: 'room-existing',
        userId: 'user-2',
        role: 'SPEAKER',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        token: 'signed-livekit-token',
        canPublish: true,
        expiresInSec: 300,
      }),
    );
    expect(__livekitMock.events).toEqual(['create:room-existing', 'sign:room-existing']);
  });

  it('fails closed without signing when explicit room creation fails', async () => {
    __livekitMock.createError = new Error('LiveKit unavailable');

    await expect(
      livekitService.issueRoomToken({
        roomId: 'room-failed',
        userId: 'user-3',
        role: 'HOST',
      }),
    ).rejects.toThrow('LiveKit unavailable');
    expect(__livekitMock.events).toEqual(['create:room-failed']);
    expect(__livekitMock.tokenTtls).toEqual([]);
  });

  it('keeps server-side room deletion wired for room closure', async () => {
    await livekitService.deleteRoom('room-ended');
    expect(__livekitMock.events).toEqual(['delete:room-ended']);
  });
});
