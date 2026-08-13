/**
 * Render-test for ExtSuggestedFollowsScreen. Seeds the useExtSuggestions query
 * cache so the list renders past its loader, then exercises the row tap
 * (onTapUser) and the per-row Follow button (onFollow + optimistic "Following"
 * state). Native modules are globally mocked in jest-setup.
 */
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { extSuggestionsKey } from '../hooks/useSuggestions';
import { suggestionsApi, type SuggestedUser } from '../api/suggestionsApi';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../test-utils/renderScreen';
import { ExtSuggestedFollowsScreen } from './ExtSuggestedFollowsScreen';

jest.setTimeout(20000);
const WAIT = { timeout: 8000 } as const;

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
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts with the header and renders a seeded suggestion row', () => {
    const { getByText, queryByLabelText, toJSON } = renderScreen(<ExtSuggestedFollowsScreen />, {
      seedQueryData: seed([makeUser()]),
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('People you may know')).toBeTruthy();
    expect(getByText('Ada Lovelace')).toBeTruthy();
    expect(queryByLabelText('View profile of Ada Lovelace')).toBeNull();
  });

  it('tapping a row invokes onTapUser with the user', () => {
    const onTapUser = jest.fn();
    const { getByLabelText } = renderScreen(<ExtSuggestedFollowsScreen onTapUser={onTapUser} />, {
      seedQueryData: seed([makeUser()]),
    });
    fireEvent.press(getByLabelText('View profile of Ada Lovelace'));
    expect(onTapUser).toHaveBeenCalledWith(expect.objectContaining({ id: 'u-1' }));
  });

  it('keeps profile and Follow as separate actions when profile navigation is available', () => {
    const { getAllByRole } = renderScreen(
      <ExtSuggestedFollowsScreen onTapUser={jest.fn()} onFollow={jest.fn()} />,
      { seedQueryData: seed([makeUser()]) },
    );

    expect(getAllByRole('button')).toHaveLength(2);
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

  it('rolls the Follow button back to "Follow" when the follow promise rejects', async () => {
    // The route passes a promise-returning onFollow (mutateAsync). Simulate a
    // rejecting API so the screen's `.catch` rollback fires and the optimistic
    // "Following" label reverts to "Follow".
    const onFollow = jest.fn().mockRejectedValue(new Error('network'));
    const { getByText, getByLabelText } = renderScreen(
      <ExtSuggestedFollowsScreen onFollow={onFollow} />,
      { seedQueryData: seed([makeUser()]) },
    );
    fireEvent.press(getByLabelText('Follow Ada Lovelace'));
    // Optimistic flip.
    expect(getByText('Following')).toBeTruthy();
    // After the rejection settles, the rollback restores "Follow".
    await waitFor(() => expect(getByText('Follow')).toBeTruthy(), WAIT);
    expect(onFollow).toHaveBeenCalledTimes(1);
  });

  it('shows an error state with a working Retry when suggestions fail to load', async () => {
    const spy = jest.spyOn(suggestionsApi, 'list').mockRejectedValue(new Error('offline'));
    const { getByText, getByLabelText } = renderScreen(<ExtSuggestedFollowsScreen />, {});
    await waitFor(() => expect(getByText("Couldn't load suggestions.")).toBeTruthy(), WAIT);
    spy.mockResolvedValueOnce([makeUser()]);
    fireEvent.press(getByLabelText('Retry'));
    await waitFor(() => expect(getByText('Ada Lovelace')).toBeTruthy(), WAIT);
  });
});
