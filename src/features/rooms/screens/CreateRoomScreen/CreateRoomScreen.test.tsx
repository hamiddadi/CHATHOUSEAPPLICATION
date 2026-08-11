/**
 * Render test for CreateRoomScreen.
 *
 * Mounts the create-room form (no route params needed), asserts the header +
 * primary CTA render, then exercises:
 *  - the header close button → navigation.goBack
 *  - a visibility radio row → selection toggles, no crash
 *  - the "Schedule for later" switch → reveals the preset chips
 *  - the disabled Start CTA with an empty title → must be a no-op (the create
 *    mutation never fires, so we never navigate away)
 *  - typing a valid title then pressing Start → fires the create mutation
 *    (which rejects under jest with no API, surfacing the catch → Alert path;
 *    we assert it does not crash and stays on-screen).
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { roomService } from '../../services/roomService';
import type { Room } from '../../../../shared/types/domain';
import { CreateRoomScreen } from './CreateRoomScreen';

const createdRoom = (): Room => ({
  id: 'room-created',
  title: 'A valid room title',
  description: null,
  category: 'tech',
  categoryEmoji: '💻',
  visibility: 'public',
  houseId: null,
  houseName: null,
  hostId: 'user-test-1',
  speakers: [],
  listeners: [],
  speakersCount: 0,
  listenersCount: 0,
  isLive: true,
  isRecording: false,
  chatEnabled: true,
  chatVisibility: 'ALL',
  startedAt: new Date(0).toISOString(),
  scheduledFor: null,
});

describe('CreateRoomScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  const mount = () => renderScreen(<CreateRoomScreen />, { route: { name: 'CreateRoom' } });

  it('mounts and renders the header title + Start CTA', () => {
    const { getByText, toJSON } = mount();
    expect(toJSON()).toBeTruthy();
    expect(getByText('Start a Room')).toBeTruthy();
    expect(getByText('Start Room')).toBeTruthy();
  });

  it('fires navigation.goBack from the header close button', () => {
    const { navigation, getByLabelText } = mount();
    // createRoom.closeA11y → "Close without starting" (present in en.json).
    fireEvent.press(getByLabelText('Close without starting'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('selects a visibility option without crashing', () => {
    const { getByLabelText } = mount();
    // VisibilityRow a11y label = `${label}: ${description}`.
    const closedRow = getByLabelText('Closed: Only people you invite');
    fireEvent.press(closedRow);
    expect(closedRow).toBeTruthy();
  });

  it('reveals schedule preset chips when the Schedule switch is toggled on', () => {
    const { getByLabelText } = mount();
    fireEvent.press(getByLabelText('Schedule for later'));
    // A preset chip ("Schedule +30 min") only mounts once scheduling is on.
    expect(getByLabelText('Schedule +30 min')).toBeTruthy();
  });

  it('does not navigate when the disabled Start CTA is pressed with an empty title', () => {
    const { navigation, getByText } = mount();
    // Title is empty → canStart is false → Button is disabled → onPress undefined.
    fireEvent.press(getByText('Start Room'));
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('creates a live room and navigates to it after a valid title is entered', async () => {
    const createSpy = jest.spyOn(roomService, 'create').mockResolvedValue(createdRoom());
    const { getByText, getByPlaceholderText, navigation } = mount();
    // createRoom.topicPlaceholder → "What do you want to talk about?".
    fireEvent.changeText(
      getByPlaceholderText('What do you want to talk about?'),
      'A valid room title',
    );
    fireEvent.press(getByText('Start Room'));
    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'A valid room title' }),
        expect.stringMatching(/^rn-/),
      );
      expect(navigation.replace).toHaveBeenCalledWith('Room', { roomId: 'room-created' });
    });
  });

  it('coalesces two presses in the same tick into one room creation action', async () => {
    let resolveCreate!: (room: Room) => void;
    const createSpy = jest
      .spyOn(roomService, 'create')
      .mockReturnValue(new Promise(resolve => (resolveCreate = resolve)));
    const { getByText, getByPlaceholderText } = mount();
    fireEvent.changeText(
      getByPlaceholderText('What do you want to talk about?'),
      'One tap, one room',
    );

    act(() => {
      fireEvent.press(getByText('Start Room'));
      fireEvent.press(getByText('Start Room'));
    });
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));

    await act(async () => resolveCreate(createdRoom()));
  });

  it('releases the submission latch after an error so the user can try again', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const createSpy = jest
      .spyOn(roomService, 'create')
      .mockRejectedValueOnce({ kind: 'validation', message: 'Invalid room' })
      .mockResolvedValue(createdRoom());
    const { getByText, getByPlaceholderText, navigation } = mount();
    fireEvent.changeText(
      getByPlaceholderText('What do you want to talk about?'),
      'Retry this room',
    );

    fireEvent.press(getByText('Start Room'));
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    fireEvent.press(getByText('Start Room'));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledTimes(2);
      expect(navigation.replace).toHaveBeenCalledWith('Room', { roomId: 'room-created' });
    });
  });
});
