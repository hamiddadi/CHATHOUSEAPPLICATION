import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { searchService, type SearchUserHit } from '../../../search/services/searchService';
import { useCreateGroup } from '../../hooks/useGroups';
import { NewMessageScreen } from './NewMessageScreen';

jest.mock('../../../search/services/searchService', () => ({
  searchService: { users: jest.fn() },
}));

jest.mock('../../hooks/useGroups', () => ({
  useCreateGroup: jest.fn(),
}));

const mockUsers = searchService.users as jest.Mock;
const mockUseCreateGroup = useCreateGroup as unknown as jest.Mock;

const makeHit = (over: Partial<SearchUserHit> = {}): SearchUserHit => ({
  id: 'u1',
  username: 'ada',
  displayName: 'Ada Lovelace',
  avatarUrl: null,
  bio: null,
  isOnline: true,
  ...over,
});

const createGroupState = (over: Record<string, unknown> = {}) => ({
  mutate: jest.fn(),
  mutateAsync: jest.fn().mockResolvedValue(undefined),
  isPending: false,
  isError: false,
  reset: jest.fn(),
  ...over,
});

describe('NewMessageScreen', () => {
  beforeEach(() => {
    mockUsers.mockReset();
    mockUseCreateGroup.mockReset();
    mockUseCreateGroup.mockReturnValue(createGroupState());
    mockUsers.mockResolvedValue([]);
  });

  it('renders the header and the empty hint before searching', () => {
    renderScreen(<NewMessageScreen />);

    // Title appears as both the header and a button label.
    expect(
      screen.getAllByText(i18n.t('messages.newMessageTitle', 'New message')).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(
        i18n.t(
          'messages.searchGroupHint',
          'Search for people. Pick one for a direct message, or several to start a group.',
        ),
      ),
    ).toBeTruthy();
  });

  it('searches and lists matching people after typing', async () => {
    mockUsers.mockResolvedValue([makeHit({ id: 'u1', displayName: 'Ada Lovelace' })]);
    renderScreen(<NewMessageScreen />);

    fireEvent.changeText(
      screen.getByPlaceholderText(i18n.t('messages.searchPeople', 'Search people')),
      'ada',
    );

    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    await waitFor(() => expect(mockUsers).toHaveBeenCalledWith('ada', 20));
    expect(screen.getByText('@ada')).toBeTruthy();
  });

  it('shows the no-results state when the search returns nothing', async () => {
    mockUsers.mockResolvedValue([]);
    renderScreen(<NewMessageScreen />);

    fireEvent.changeText(
      screen.getByPlaceholderText(i18n.t('messages.searchPeople', 'Search people')),
      'zzz',
    );

    expect(await screen.findByText(i18n.t('messages.noResults', 'No one found'))).toBeTruthy();
  });

  it('opens a 1:1 thread (replace) when exactly one person is selected', async () => {
    mockUsers.mockResolvedValue([makeHit({ id: 'u1', displayName: 'Ada Lovelace' })]);
    const { navigation } = renderScreen(<NewMessageScreen />);

    fireEvent.changeText(
      screen.getByPlaceholderText(i18n.t('messages.searchPeople', 'Search people')),
      'ada',
    );

    fireEvent.press(await screen.findByLabelText('Ada Lovelace'));
    fireEvent.press(await screen.findByText(i18n.t('messages.message', 'Message')));

    expect(navigation.replace).toHaveBeenCalledWith('ChatDetail', { conversationId: 'u1' });
  });

  it('creates a group when two or more people are selected', async () => {
    const mutate = jest.fn();
    mockUseCreateGroup.mockReturnValue(createGroupState({ mutate }));
    mockUsers.mockResolvedValue([
      makeHit({ id: 'u1', username: 'ada', displayName: 'Ada Lovelace' }),
      makeHit({ id: 'u2', username: 'grace', displayName: 'Grace Hopper' }),
    ]);
    renderScreen(<NewMessageScreen />);

    fireEvent.changeText(
      screen.getByPlaceholderText(i18n.t('messages.searchPeople', 'Search people')),
      'a',
    );

    fireEvent.press(await screen.findByLabelText('Ada Lovelace'));
    fireEvent.press(await screen.findByLabelText('Grace Hopper'));
    fireEvent.press(await screen.findByText(/Create group/));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({ memberIds: ['u1', 'u2'] });
  });

  it('goes back when the close button is pressed', () => {
    const { navigation } = renderScreen(<NewMessageScreen />);

    fireEvent.press(screen.getByLabelText(i18n.t('common.close', 'Close')));

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
