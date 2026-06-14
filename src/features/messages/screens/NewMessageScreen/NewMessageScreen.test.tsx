/**
 * Render test for NewMessageScreen (the people picker that opens a 1:1 thread or
 * creates a group). Mounts, asserts the empty-state hint, exercises the close
 * button (→ goBack), and — by mocking the search service so results render —
 * selects a single person and presses the primary "Message" CTA, asserting it
 * `replace`s into ChatDetail with the chosen peer id.
 */
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { searchService, type SearchUserHit } from '../../../search/services/searchService';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { NewMessageScreen } from './NewMessageScreen';

const hit = (id: string, username: string): SearchUserHit => ({
  id,
  username,
  displayName: username,
  avatarUrl: null,
  bio: null,
  isOnline: false,
});

describe('NewMessageScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts and shows the search empty-state hint', () => {
    const { getAllByText } = renderScreen(<NewMessageScreen />, {
      route: { name: 'NewMessage' },
    });
    // "New message" appears as both the header title and the empty-state title.
    expect(getAllByText('New message').length).toBeGreaterThan(0);
  });

  it('close button calls navigation.goBack', () => {
    const { navigation, getByLabelText } = renderScreen(<NewMessageScreen />, {
      route: { name: 'NewMessage' },
    });
    fireEvent.press(getByLabelText('Close'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('selecting one person and pressing Message replaces into ChatDetail', async () => {
    jest
      .spyOn(searchService, 'users')
      .mockResolvedValue([hit('peer-42', 'alice'), hit('peer-43', 'bob')]);

    const { navigation, getByPlaceholderText, getByText, getByLabelText } = renderScreen(
      <NewMessageScreen />,
      { route: { name: 'NewMessage' } },
    );

    fireEvent.changeText(getByPlaceholderText('Search people'), 'al');
    // Debounce (250ms) + async search resolve → row appears.
    const row = await waitFor(() => getByLabelText('alice'), { timeout: 2000 });
    fireEvent.press(row);

    // Single selection → CTA label is "Message".
    const cta = await waitFor(() => getByText('Message'));
    fireEvent.press(cta);
    expect(navigation.replace).toHaveBeenCalledWith('ChatDetail', { conversationId: 'peer-42' });
  });

  it('selecting two people shows a group CTA (create group label)', async () => {
    jest
      .spyOn(searchService, 'users')
      .mockResolvedValue([hit('peer-42', 'alice'), hit('peer-43', 'bob')]);

    const { getByPlaceholderText, getByText, getByLabelText } = renderScreen(<NewMessageScreen />, {
      route: { name: 'NewMessage' },
    });

    fireEvent.changeText(getByPlaceholderText('Search people'), 'a');
    fireEvent.press(await waitFor(() => getByLabelText('alice'), { timeout: 2000 }));
    fireEvent.press(getByLabelText('bob'));
    // Two selected → CTA switches to the group-create label "Create group · 2".
    await waitFor(() => {
      expect(getByText(/create group/i)).toBeTruthy();
    });
  });
});
