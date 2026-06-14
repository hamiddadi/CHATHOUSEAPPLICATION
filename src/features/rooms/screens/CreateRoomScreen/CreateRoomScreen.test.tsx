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
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { CreateRoomScreen } from './CreateRoomScreen';

describe('CreateRoomScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
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

  it('attempts to create the room after a valid title is entered (no crash on API failure)', async () => {
    const { getByText, getByPlaceholderText } = mount();
    // createRoom.topicPlaceholder → "What do you want to talk about?".
    fireEvent.changeText(
      getByPlaceholderText('What do you want to talk about?'),
      'A valid room title',
    );
    fireEvent.press(getByText('Start Room'));
    // The mutation fires against an absent API → rejects → handled by the catch
    // (Alert). We only assert the press didn't throw and the screen survives.
    await waitFor(() => {
      expect(getByText('Start a Room')).toBeTruthy();
    });
  });
});
