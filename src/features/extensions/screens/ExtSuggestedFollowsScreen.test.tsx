import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useExtSuggestions } from '../hooks/useSuggestions';
import type { SuggestedUser } from '../api/suggestionsApi';
import { ExtSuggestedFollowsScreen } from './ExtSuggestedFollowsScreen';

jest.mock('../hooks/useSuggestions', () => {
  const actual = jest.requireActual('../hooks/useSuggestions');
  return { ...actual, useExtSuggestions: jest.fn() };
});

const mockUseExtSuggestions = useExtSuggestions as jest.Mock;

type QueryState = ReturnType<typeof useExtSuggestions>;

const queryState = (over: Partial<QueryState> = {}): QueryState =>
  ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
    isRefetching: false,
    isFetching: false,
    ...over,
  }) as unknown as QueryState;

const makeUser = (over: Partial<SuggestedUser> = {}): SuggestedUser => ({
  id: 'u1',
  username: 'janedoe',
  displayName: 'Jane Doe',
  avatarUrl: null,
  bio: null,
  followerCount: 1200,
  sharedInterestsCount: 0,
  reason: 'trending',
  ...over,
});

describe('ExtSuggestedFollowsScreen', () => {
  beforeEach(() => {
    mockUseExtSuggestions.mockReset();
  });

  it('renders the header title without crashing', () => {
    mockUseExtSuggestions.mockReturnValue(queryState({ isLoading: true }));
    renderScreen(<ExtSuggestedFollowsScreen />);
    expect(
      screen.getByText(i18n.t('extensions.suggested.title', 'People you may know')),
    ).toBeTruthy();
  });

  it('shows the empty state when there are no suggestions', () => {
    mockUseExtSuggestions.mockReturnValue(queryState({ data: [] }));
    renderScreen(<ExtSuggestedFollowsScreen />);
    expect(
      screen.getByText(
        i18n.t('extensions.suggested.empty', 'No suggestions yet. Come back later.'),
      ),
    ).toBeTruthy();
  });

  it('renders a row for each suggested user when loaded', () => {
    mockUseExtSuggestions.mockReturnValue(
      queryState({
        data: [makeUser(), makeUser({ id: 'u2', displayName: 'John Roe', username: 'johnroe' })],
      }),
    );
    renderScreen(<ExtSuggestedFollowsScreen />);
    expect(screen.getByText('Jane Doe')).toBeTruthy();
    expect(screen.getByText('John Roe')).toBeTruthy();
  });

  it('calls onTapUser when a user row is pressed', () => {
    const user = makeUser();
    mockUseExtSuggestions.mockReturnValue(queryState({ data: [user] }));
    const onTapUser = jest.fn();
    renderScreen(<ExtSuggestedFollowsScreen onTapUser={onTapUser} />);
    fireEvent.press(
      screen.getByLabelText(
        i18n.t('extensions.suggested.viewProfile', 'View profile of {{name}}', {
          name: 'Jane Doe',
        }),
      ),
    );
    expect(onTapUser).toHaveBeenCalledWith(user);
  });

  it('calls onFollow and reflects the followed state in the button', async () => {
    const user = makeUser();
    mockUseExtSuggestions.mockReturnValue(queryState({ data: [user] }));
    const onFollow = jest.fn().mockResolvedValue(undefined);
    renderScreen(<ExtSuggestedFollowsScreen onFollow={onFollow} />);

    fireEvent.press(
      screen.getByLabelText(
        i18n.t('extensions.suggested.followUserA11y', 'Follow {{name}}', { name: 'Jane Doe' }),
      ),
    );

    expect(onFollow).toHaveBeenCalledWith(user);
    await waitFor(() =>
      expect(screen.getByText(i18n.t('extensions.suggested.following', 'Following'))).toBeTruthy(),
    );
  });

  it('does not fire a duplicate follow once already followed', async () => {
    const user = makeUser();
    mockUseExtSuggestions.mockReturnValue(queryState({ data: [user] }));
    const onFollow = jest.fn().mockResolvedValue(undefined);
    renderScreen(<ExtSuggestedFollowsScreen onFollow={onFollow} />);

    const followLabel = i18n.t('extensions.suggested.followUserA11y', 'Follow {{name}}', {
      name: 'Jane Doe',
    });
    fireEvent.press(screen.getByLabelText(followLabel));
    await waitFor(() =>
      expect(screen.getByText(i18n.t('extensions.suggested.following', 'Following'))).toBeTruthy(),
    );

    fireEvent.press(screen.getByLabelText(followLabel));
    expect(onFollow).toHaveBeenCalledTimes(1);
  });
});
