/**
 * Unit test for currentRoomStore — the SINGLE source of truth for the viewer's
 * mute state.
 *
 * The BLOQUANT bug this guards against: `setRoom` used to reset `isMuted` to
 * false on every room-detail refetch. roomAudioService re-applies
 * `getState().isMuted` after a LiveKit token renew/rejoin, so a refetch that
 * silently cleared the flag re-opened the mic while the badge still read
 * "muted". The contract now is: `setRoom` NEVER touches `isMuted` — only
 * `setMuted` / `toggleMute` / `clear` do.
 */
import type { RoomParticipant } from '../../../shared/types/domain';
import { useCurrentRoomStore } from './currentRoomStore';

const speaker = (id: string): RoomParticipant => ({
  id,
  username: `u_${id}`,
  displayName: id,
  avatarUrl: null,
  role: 'speaker',
  audio: 'idle',
  handRaised: false,
});

const room = (overrides: Partial<ReturnType<typeof baseRoom>> = {}) => ({
  ...baseRoom(),
  ...overrides,
});
const baseRoom = () => ({
  id: 'room-1',
  title: 'Deep dive',
  speakers: [speaker('a')],
  listenersCount: 3,
});

describe('currentRoomStore mute lifecycle', () => {
  beforeEach(() => {
    useCurrentRoomStore.getState().clear();
  });

  it('keeps isMuted=true across a setRoom (detail refetch)', () => {
    const store = useCurrentRoomStore.getState();
    store.setRoom(room());
    store.setMuted(true);
    expect(useCurrentRoomStore.getState().isMuted).toBe(true);

    // Simulate a React Query detail refetch replacing the room object with a
    // fresh reference (same id, updated listenersCount). This MUST NOT reset
    // the mute flag.
    useCurrentRoomStore.getState().setRoom(room({ listenersCount: 9 }));

    expect(useCurrentRoomStore.getState().isMuted).toBe(true);
    expect(useCurrentRoomStore.getState().room?.listenersCount).toBe(9);
  });

  it('keeps isMuted=false across a setRoom when unmuted', () => {
    const store = useCurrentRoomStore.getState();
    store.setRoom(room());
    store.setMuted(false);
    useCurrentRoomStore.getState().setRoom(room({ title: 'renamed' }));
    expect(useCurrentRoomStore.getState().isMuted).toBe(false);
    expect(useCurrentRoomStore.getState().room?.title).toBe('renamed');
  });

  it('toggleMute flips the flag and it survives a subsequent setRoom', () => {
    const store = useCurrentRoomStore.getState();
    store.setRoom(room());
    store.toggleMute(); // false -> true
    expect(useCurrentRoomStore.getState().isMuted).toBe(true);
    useCurrentRoomStore.getState().setRoom(room({ listenersCount: 42 }));
    expect(useCurrentRoomStore.getState().isMuted).toBe(true);
  });

  it('clear() resets both the room and the mute flag', () => {
    const store = useCurrentRoomStore.getState();
    store.setRoom(room());
    store.setMuted(true);
    useCurrentRoomStore.getState().clear();
    expect(useCurrentRoomStore.getState().room).toBeNull();
    expect(useCurrentRoomStore.getState().isMuted).toBe(false);
  });
});
