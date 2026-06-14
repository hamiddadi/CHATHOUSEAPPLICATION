/**
 * Render-test for ExtSuggestedFollowsScreen. Seeds the useExtSuggestions query
 * cache so the list renders past its loader, then exercises the row tap
 * (onTapUser) and the per-row Follow button (onFollow + optimistic "Following"
 * state). Native modules are globally mocked in jest-setup.
 */
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { extSuggestionsKey } from '../hooks/useSuggestions';
import type { SuggestedUser } from '../api/suggestionsApi';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../test-utils/renderScreen';
import { ExtSuggestedFollowsScreen } from './ExtSuggestedFollowsScreen';

const makeUser = (overrides: Partial<SuggestedUser> = {}): SuggestedUser => ({
  id: 'u-1',
  username: 'ada',
  displayName: 'Ada Lovelace',
  avatarUrl: null,
  bio: 'First programmer.',
  followerCount: 1234,
  sharedInterestsCount: 3,
  reason: 'shared_interests',
  ...overrides,
});

// useExtSuggestions(30) → extSuggestionsKey(30); priming it makes isLoading false.
const seed = (users: SuggestedUser[]) => [{ key: [...extSuggestionsKey(30)], data: users }];

describe('ExtSuggestedFollowsScreen', () => {
  beforeEach(() => mockAuthenticated());
  afterEach(() => resetAuth());

  it('mounts with the header and renders a seeded suggestion row', () => {
    const { getByText, toJSON } = renderScreen(<ExtSuggestedFollowsScreen />, {
      seedQueryData: seed([makeUser()]),
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('People you may know')).toBeTruthy();
    expect(getByText('Ada Lovelace')).toBeTruthy();
  });

  it('tapping a row invokes onTapUser with the user', () => {
    const onTapUser = jest.fn();
    const { getByLabelText } = renderScreen(<ExtSuggestedFollowsScreen onTapUser={onTapUser} />, {
      seedQueryData: seed([makeUser()]),
    });
    fireEvent.press(getByLabelText('View profile of Ada Lovelace'));
    expect(onTapUser).toHaveBeenCalledWith(expect.objectContaining({ id: 'u-1' }));
  });

  it('Follow button fires onFollow and flips to the "Following" state', () => {
    const onFollow = jest.fn().mockResolvedValue(undefined);
    const { getByText, getByLabelText } = renderScreen(
      <ExtSuggestedFollowsScreen onFollow={onFollow} />,
      { seedQueryData: seed([makeUser()]) },
    );
    fireEvent.press(getByLabelText('Follow Ada Lovelace'));
    expect(onFollow).toHaveBeenCalledWith(expect.objectContaining({ id: 'u-1' }));
    // Optimistic local state flips the label to "Following".
    expect(getByText('Following')).toBeTruthy();
  });

  it('shows the empty state when there are no suggestions', () => {
    const { getByText } = renderScreen(<ExtSuggestedFollowsScreen />, {
      seedQueryData: seed([]),
    });
    expect(getByText('No suggestions yet. Come back later.')).toBeTruthy();
  });
});
