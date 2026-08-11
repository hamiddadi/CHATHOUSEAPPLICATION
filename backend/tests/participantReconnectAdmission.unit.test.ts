import {
  canRefreshReconnectAdmission,
  type ReconnectAdmissionState,
} from '../src/modules/rooms/participant-admission.policy';

const now = new Date('2026-08-11T12:00:00.000Z');
const roomId = 'room-1';
const eligible = (): ReconnectAdmissionState => ({
  room: { isLive: true, endedAt: null },
  user: { currentRoomId: roomId, deletedAt: null, suspendedUntil: null },
  participant: {
    id: 'participant-1',
    leftAt: null,
    admissionConfirmedAt: new Date('2026-08-11T11:55:00.000Z'),
  },
});

describe('reconnect admission refresh policy', () => {
  it('allows an active, eligible and already-confirmed lease', () => {
    expect(canRefreshReconnectAdmission(roomId, eligible(), now)).toBe(true);
  });

  it('never promotes a null admission lease', () => {
    const state = eligible();
    state.participant!.admissionConfirmedAt = null;
    expect(canRefreshReconnectAdmission(roomId, state, now)).toBe(false);
  });

  const revokedStates: Array<[string, (state: ReconnectAdmissionState) => void]> = [
    ['left participant', state => (state.participant!.leftAt = now)],
    [
      'ended room',
      state => {
        state.room = { isLive: false, endedAt: now };
      },
    ],
    ['room mismatch', state => (state.user!.currentRoomId = 'room-2')],
    ['deleted user', state => (state.user!.deletedAt = now)],
    ['suspended user', state => (state.user!.suspendedUntil = new Date(now.getTime() + 60_000))],
  ];

  it.each(revokedStates)('rejects a concurrently revoked state: %s', (_label, revoke) => {
    const state = eligible();
    revoke(state);
    expect(canRefreshReconnectAdmission(roomId, state, now)).toBe(false);
  });
});
