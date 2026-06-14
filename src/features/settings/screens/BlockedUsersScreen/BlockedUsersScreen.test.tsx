/**
 * Render-test for BlockedUsersScreen. The screen reads `useBlockedUsers()`
 * (Loader while pending, EmptyState on error, FlatList otherwise), so we prime
 * `socialKeys.blocked()` to render the populated list (or an explicit empty
 * array for the empty state). We exercise the header back button and the
 * per-row Unblock button (fires the unblock mutation — its dispatch must not
 * throw synchronously).
 */
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { socialKeys } from '../../../social/hooks/useSocial';
import type { UserSummary } from '../../../../shared/types/domain';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { BlockedUsersScreen } from './BlockedUsersScreen';

const makeBlocked = (overrides: Partial<UserSummary> = {}): UserSummary => ({
  id: 'blocked-1',
  username: 'baduser',
  displayName: 'Bad User',
  avatarUrl: null,
  ...overrides,
});

const seedBlocked = (users: UserSummary[]) => ({ key: [...socialKeys.blocked()], data: users });

describe('BlockedUsersScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts the populated list and shows a blocked user', () => {
    const { getByText, toJSON } = renderScreen(<BlockedUsersScreen />, {
      seedQueryData: [seedBlocked([makeBlocked()])],
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('Bad User')).toBeTruthy();
    expect(getByText('@baduser')).toBeTruthy();
  });

  it('renders the empty state when the blocked list is empty', () => {
    const { getByText } = renderScreen(<BlockedUsersScreen />, {
      seedQueryData: [seedBlocked([])],
    });
    expect(getByText('No blocked accounts')).toBeTruthy();
  });

  it('header back button calls navigation.goBack', () => {
    const { getByLabelText, navigation } = renderScreen(<BlockedUsersScreen />, {
      seedQueryData: [seedBlocked([])],
    });
    fireEvent.press(getByLabelText('Back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('Unblock button press dispatches the mutation without throwing', () => {
    const { getByText } = renderScreen(<BlockedUsersScreen />, {
      seedQueryData: [seedBlocked([makeBlocked()])],
    });
    // The Button renders its label as text; the unblock.mutate dispatch must
    // not throw synchronously (the network layer is not mocked).
    expect(() => fireEvent.press(getByText('Unblock'))).not.toThrow();
  });

  it('shows the loader header (pending) when nothing is seeded', () => {
    const { getByText } = renderScreen(<BlockedUsersScreen />);
    // Header title is always present; with an empty cache the query is pending
    // and the Loader renders below it — the screen mounts without crashing.
    expect(getByText('Blocked accounts')).toBeTruthy();
  });
});
