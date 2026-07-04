/**
 * Behaviour test for RoomControlsSheet — the host/moderator "Contrôles de la
 * room" panel. Verifies that each of the seven control rows is wired to the
 * correct mutation / API call with the correct payload, in BOTH toggle
 * directions where applicable:
 *
 *   1. Modifier le titre        → onClose() + onEditTitle()
 *   2. Inviter des followers    → onClose() + onInvite()
 *   3. Mute tous les speakers   → confirm alert → muteAll.mutate({ includeHost:false })
 *   4. (Dés)activer le chat     → toggleChat.mutate({ chatEnabled })
 *   5. Limiter le chat aux mods → toggleChat.mutate({ chatVisibility })
 *   6. Lever de main            → roomSettingsExtApi.setHandRaise(next restriction)
 *   7. (Dé)verrouiller la room  → lockRoom.mutate({ locked })
 *
 * The three room mutations (lock / mute-all / toggle-chat) come from
 * `useRooms`, mocked to expose spyable `mutate`. The hand-raise cycle uses a
 * real react-query mutation whose `mutationFn` hits `roomSettingsExtApi`, which
 * is mocked — so that assertion is awaited via `waitFor`.
 *
 * i18n boots to English under jest (see jest-setup.ts) so t()-driven labels are
 * the en.json strings; the lock + hand-raise labels are also t()-driven now (the
 * former hard-coded French was internationalised), so they resolve to the inline
 * English defaults under jest.
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderScreen } from '../../../../test-utils/renderScreen';
import { useLockRoom, useMuteAllInRoom, useToggleRoomChat } from '../../hooks/useRooms';
import { roomSettingsExtApi } from '../../../extensions/api/roomSettingsExtApi';
import { RoomControlsSheet } from './RoomControlsSheet';

jest.mock('../../hooks/useRooms', () => ({
  useLockRoom: jest.fn(),
  useMuteAllInRoom: jest.fn(),
  useToggleRoomChat: jest.fn(),
}));

jest.mock('../../../extensions/api/roomSettingsExtApi', () => ({
  roomSettingsExtApi: {
    get: jest.fn(),
    setHandRaise: jest.fn(),
  },
}));

type AlertButton = { text?: string; style?: string; onPress?: () => void };

const ROOM_ID = 'room-1';

const mockLockMutate = jest.fn();
const mockMuteAllMutate = jest.fn();
const mockToggleChatMutate = jest.fn();

describe('RoomControlsSheet', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    (useLockRoom as jest.Mock).mockReturnValue({ mutate: mockLockMutate });
    (useMuteAllInRoom as jest.Mock).mockReturnValue({ mutate: mockMuteAllMutate });
    (useToggleRoomChat as jest.Mock).mockReturnValue({ mutate: mockToggleChatMutate });
    (roomSettingsExtApi.get as jest.Mock).mockResolvedValue({
      handRaiseRestriction: 'everyone',
      coHostIds: [],
    });
    (roomSettingsExtApi.setHandRaise as jest.Mock).mockResolvedValue({
      handRaiseRestriction: 'followers',
      coHostIds: [],
    });
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
    alertSpy.mockRestore();
  });

  const mount = (props: Partial<React.ComponentProps<typeof RoomControlsSheet>> = {}) => {
    const onClose = jest.fn();
    const onEditTitle = jest.fn();
    const onInvite = jest.fn();
    const utils = renderScreen(
      <RoomControlsSheet
        visible
        roomId={ROOM_ID}
        chatEnabled
        chatVisibility="ALL"
        isLocked={false}
        onClose={onClose}
        onEditTitle={onEditTitle}
        onInvite={onInvite}
        {...props}
      />,
    );
    return { ...utils, onClose, onEditTitle, onInvite };
  };

  it('renders the sheet title and all seven control rows', () => {
    const { getByLabelText, getByText } = mount();
    expect(getByText('Room controls')).toBeTruthy();
    expect(getByLabelText('Edit title')).toBeTruthy();
    expect(getByLabelText('Invite followers')).toBeTruthy();
    expect(getByLabelText('Mute all speakers')).toBeTruthy();
    expect(getByLabelText('Disable chat')).toBeTruthy();
    expect(getByLabelText('Limit chat to moderators')).toBeTruthy();
    expect(getByLabelText('Hand raising: everyone')).toBeTruthy();
    expect(getByLabelText('Lock the room')).toBeTruthy();
  });

  it('closes the sheet and opens the title editor when "Edit title" is pressed', () => {
    const { getByLabelText, onClose, onEditTitle } = mount();
    fireEvent.press(getByLabelText('Edit title'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onEditTitle).toHaveBeenCalledTimes(1);
  });

  it('closes the sheet and triggers invite navigation when "Invite followers" is pressed', () => {
    const { getByLabelText, onClose, onInvite } = mount();
    fireEvent.press(getByLabelText('Invite followers'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onInvite).toHaveBeenCalledTimes(1);
  });

  it('confirms then mutes all speakers (host excluded), and shows the done alert on success', () => {
    const { getByLabelText } = mount();
    fireEvent.press(getByLabelText('Mute all speakers'));

    // First alert = confirmation prompt.
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const buttons = (alertSpy.mock.calls[0][2] ?? []) as AlertButton[];
    const confirm = buttons.find(b => b.style === 'destructive');
    expect(confirm).toBeDefined();

    confirm?.onPress?.();
    expect(mockMuteAllMutate).toHaveBeenCalledWith(
      { roomId: ROOM_ID, includeHost: false },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );

    // Drive the success callback the mutation would invoke → user-facing "Done".
    const opts = mockMuteAllMutate.mock.calls[0][1] as {
      onSuccess: (r: { mutedCount: number }) => void;
    };
    opts.onSuccess({ mutedCount: 3 });
    expect(alertSpy).toHaveBeenCalledTimes(2);
    expect(alertSpy.mock.calls[1][0]).toBe('Done');
    expect(alertSpy.mock.calls[1][1]).toBe('3 speaker(s) muted.');
  });

  it('disables chat (chatEnabled=false) when chat is currently enabled', () => {
    const { getByLabelText } = mount({ chatEnabled: true });
    fireEvent.press(getByLabelText('Disable chat'));
    expect(mockToggleChatMutate).toHaveBeenCalledWith(
      { roomId: ROOM_ID, chatEnabled: false },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('enables chat (chatEnabled=true) when chat is currently disabled', () => {
    const { getByLabelText } = mount({ chatEnabled: false });
    fireEvent.press(getByLabelText('Enable chat'));
    expect(mockToggleChatMutate).toHaveBeenCalledWith(
      { roomId: ROOM_ID, chatEnabled: true },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('limits chat to moderators (chatVisibility=mods) when currently visible to all', () => {
    const { getByLabelText } = mount({ chatVisibility: 'ALL' });
    fireEvent.press(getByLabelText('Limit chat to moderators'));
    expect(mockToggleChatMutate).toHaveBeenCalledWith(
      { roomId: ROOM_ID, chatVisibility: 'mods' },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('re-opens chat to everyone (chatVisibility=all) when currently mods-only', () => {
    const { getByLabelText } = mount({ chatVisibility: 'MODS_ONLY' });
    fireEvent.press(getByLabelText('Make chat visible to everyone'));
    expect(mockToggleChatMutate).toHaveBeenCalledWith(
      { roomId: ROOM_ID, chatVisibility: 'all' },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('cycles the raise-hand restriction everyone → followers via the ext API', async () => {
    const { getByLabelText } = mount();
    fireEvent.press(getByLabelText('Hand raising: everyone'));
    await waitFor(() =>
      expect(roomSettingsExtApi.setHandRaise).toHaveBeenCalledWith(ROOM_ID, 'followers'),
    );
  });

  it('locks the room (locked=true) when currently unlocked', () => {
    const { getByLabelText } = mount({ isLocked: false });
    fireEvent.press(getByLabelText('Lock the room'));
    expect(mockLockMutate).toHaveBeenCalledWith(
      { roomId: ROOM_ID, locked: true },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('unlocks the room (locked=false) when currently locked', () => {
    const { getByLabelText } = mount({ isLocked: true });
    fireEvent.press(getByLabelText('Unlock the room'));
    expect(mockLockMutate).toHaveBeenCalledWith(
      { roomId: ROOM_ID, locked: false },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });
});
