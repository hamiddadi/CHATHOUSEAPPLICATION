import {
  enforceLivekitParticipantPolicyLocked,
  type LivekitParticipantPolicyProvider,
  type LivekitParticipantPolicyStore,
  type LockedParticipantPolicyState,
  type LockedRoomPolicyState,
  type LockedUserPolicyState,
} from '../src/workers/livekitParticipantPolicy.core';

const LEGAL_VERSION = '2026-07-29';

type Transaction = { readonly id: 'tx' };

interface FixtureOverrides {
  room?: LockedRoomPolicyState | null;
  user?: LockedUserPolicyState | null;
  participant?: LockedParticipantPolicyState | null;
}

const fixture = (overrides: FixtureOverrides = {}) => {
  const events: string[] = [];
  const room =
    overrides.room === undefined
      ? { hostId: 'host-1', isLive: true, endedAt: null }
      : overrides.room;
  const user =
    overrides.user === undefined
      ? {
          deletedAt: null,
          suspendedUntil: null,
          termsAcceptedVersion: LEGAL_VERSION,
          termsAcceptedAt: new Date('2026-07-29T00:00:00.000Z'),
          privacyNoticeAcknowledgedVersion: LEGAL_VERSION,
          privacyNoticeAcknowledgedAt: new Date('2026-07-29T00:00:00.000Z'),
          legalAcceptanceLocale: 'fr',
        }
      : overrides.user;
  const participant =
    overrides.participant === undefined
      ? {
          role: 'SPEAKER' as const,
          isMuted: false,
          leftAt: null,
          admissionConfirmedAt: new Date('2026-08-11T00:00:00.000Z'),
        }
      : overrides.participant;

  const store: LivekitParticipantPolicyStore<Transaction> = {
    transaction: async (work, options) => {
      events.push(`transaction:${options.maxWait}:${options.timeout}`);
      return work({ id: 'tx' });
    },
    setLocalLockTimeout: async (_transaction, milliseconds) => {
      events.push(`lock-timeout:${milliseconds}`);
    },
    lockRoom: async () => {
      events.push('lock-room');
    },
    lockUser: async () => {
      events.push('lock-user');
    },
    lockParticipant: async () => {
      events.push('lock-participant');
    },
    readRoom: async () => {
      events.push('read-room');
      return room;
    },
    readUser: async () => {
      events.push('read-user');
      return user;
    },
    readParticipant: async () => {
      events.push('read-participant');
      return participant;
    },
  };
  const provider: jest.Mocked<LivekitParticipantPolicyProvider> = {
    removeParticipant: jest.fn<Promise<void>, [string, string]>().mockImplementation(async () => {
      events.push('provider-remove');
    }),
    setParticipantCanPublish: jest
      .fn<Promise<void>, [string, string, boolean]>()
      .mockImplementation(async (_roomId, _userId, canPublish) => {
        events.push(`provider-permissions:${canPublish}`);
      }),
  };
  const enforce = () =>
    enforceLivekitParticipantPolicyLocked({
      store,
      provider,
      legalDocumentVersion: LEGAL_VERSION,
      roomId: 'room-1',
      userId: 'user-1',
      now: new Date('2026-08-11T12:00:00.000Z'),
    });
  return { events, provider, enforce, room, user, participant };
};

describe('shared LiveKit participant policy core', () => {
  it('locks Room -> User -> Participant and applies publish permission before commit', async () => {
    const test = fixture();

    await expect(test.enforce()).resolves.toEqual({ kind: 'permissions', canPublish: true });
    expect(test.events).toEqual([
      'transaction:1000:17000',
      'lock-timeout:1000',
      'lock-room',
      'lock-user',
      'lock-participant',
      'read-room',
      'read-user',
      'read-participant',
      'provider-permissions:true',
    ]);
  });

  it.each([
    [
      'unconfirmed socket admission',
      { participant: { ...fixture().participant!, admissionConfirmedAt: null } },
    ],
    ['left participant', { participant: { ...fixture().participant!, leftAt: new Date() } }],
    ['missing participant after block', { participant: null }],
    ['ended room', { room: { hostId: 'host-1', isLive: false, endedAt: new Date() } }],
    ['deleted user', { user: { ...fixture().user!, deletedAt: new Date() } }],
    [
      'suspended user',
      { user: { ...fixture().user!, suspendedUntil: new Date('2026-08-12T00:00:00.000Z') } },
    ],
  ])('removes provider access for %s', async (_label, overrides) => {
    const test = fixture(overrides);

    await expect(test.enforce()).resolves.toEqual({ kind: 'remove' });
    expect(test.provider.removeParticipant).toHaveBeenCalledWith('room-1', 'user-1');
    expect(test.provider.setParticipantCanPublish).not.toHaveBeenCalled();
  });

  it.each([
    ['listener', { participant: { ...fixture().participant!, role: 'LISTENER' as const } }],
    ['muted speaker', { participant: { ...fixture().participant!, isMuted: true } }],
    [
      'stale legal acceptance',
      { user: { ...fixture().user!, termsAcceptedVersion: '2026-01-01' } },
    ],
    [
      'missing legal timestamp',
      { user: { ...fixture().user!, privacyNoticeAcknowledgedAt: null } },
    ],
  ])('keeps %s connected but forces receive-only permission', async (_label, overrides) => {
    const test = fixture(overrides);

    await expect(test.enforce()).resolves.toEqual({ kind: 'permissions', canPublish: false });
    expect(test.provider.setParticipantCanPublish).toHaveBeenCalledWith('room-1', 'user-1', false);
  });

  it('treats a stale participant HOST label as receive-only when Room.hostId differs', async () => {
    const base = fixture();
    const test = fixture({
      participant: { ...base.participant!, role: 'HOST' },
      room: { hostId: 'new-host', isLive: true, endedAt: null },
    });

    await expect(test.enforce()).resolves.toEqual({ kind: 'permissions', canPublish: false });
    expect(test.provider.setParticipantCanPublish).toHaveBeenCalledWith('room-1', 'user-1', false);
  });

  it('allows the authoritative Room.hostId to publish even if its row is not labelled HOST', async () => {
    const base = fixture();
    const test = fixture({
      participant: { ...base.participant!, role: 'LISTENER' },
      room: { hostId: 'user-1', isLive: true, endedAt: null },
    });

    await expect(test.enforce()).resolves.toEqual({ kind: 'permissions', canPublish: true });
  });

  it('matches application legal acceptance when locale is absent', async () => {
    const base = fixture();
    const test = fixture({ user: { ...base.user!, legalAcceptanceLocale: null } });

    await expect(test.enforce()).resolves.toEqual({ kind: 'permissions', canPublish: true });
  });

  it('propagates provider failure so the transaction and webhook/outbox retry', async () => {
    const test = fixture();
    test.provider.setParticipantCanPublish.mockRejectedValueOnce(new Error('provider unavailable'));

    await expect(test.enforce()).rejects.toThrow('provider unavailable');
  });
});
