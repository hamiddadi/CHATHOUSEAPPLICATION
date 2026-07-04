/**
 * Render-test for BlockedUsersScreen. The screen reads `useBlockedUsers()`
 * (Loader while pending, EmptyState on error, FlatList otherwise), so we prime
 * `socialKeys.blocked()` to render the populated list (or an explicit empty
 * array for the empty state). We exercise the header back button and the
 * per-row Unblock button (fires the unblock mutation — its dispatch must not
 * throw synchronously).
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { socialKeys } from '../../../social/hooks/useSocial';
import { socialService } from '../../../social/services/socialService';
import type { UserSummary } from '../../../../shared/types/domain';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { BlockedUsersScreen } from './BlockedUsersScreen';

type AlertButton = { text?: string; style?: string; onPress?: () => void };

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

  it('Unblock button asks for confirmation before unblocking (no immediate mutation)', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const unblockSpy = jest.spyOn(socialService, 'unblock').mockResolvedValue({ unblocked: true });
    const { getByText } = renderScreen(<BlockedUsersScreen />, {
      seedQueryData: [seedBlocked([makeBlocked()])],
    });
    // Tapping the row's Unblock button must NOT unblock straight away — it opens
    // a confirmation Alert first (audit QA 2026-07-02: a single accidental tap
    // could re-expose the viewer to a harasser).
    fireEvent.press(getByText('Unblock'));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(unblockSpy).not.toHaveBeenCalled();
  });

  it('unblocks only after the destructive confirm button is pressed', async () => {
    let captured: AlertButton[] = [];
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      captured = (buttons as AlertButton[]) ?? [];
    });
    const unblockSpy = jest.spyOn(socialService, 'unblock').mockResolvedValue({ unblocked: true });
    const { getByText } = renderScreen(<BlockedUsersScreen />, {
      seedQueryData: [seedBlocked([makeBlocked()])],
    });
    fireEvent.press(getByText('Unblock'));
    const confirm = captured.find(b => b.style === 'destructive');
    expect(confirm).toBeDefined();
    // Simulate the user confirming → the mutation fires (async) with the id.
    confirm?.onPress?.();
    await waitFor(() => expect(unblockSpy).toHaveBeenCalledWith('blocked-1'));
  });

  it('shows an error state with a Retry button that refetches when the list fails to load', async () => {
    const listSpy = jest
      .spyOn(socialService, 'listBlocked')
      .mockRejectedValue(new Error('network down'));
    const { getByText } = renderScreen(<BlockedUsersScreen />);
    // Error branch → EmptyState with a retry action (audit QA 2026-07-02: an
    // error must not masquerade as an empty "No blocked accounts" state).
    await waitFor(() => expect(getByText("Couldn't load blocked accounts")).toBeTruthy());
    const retry = getByText('Retry');
    expect(retry).toBeTruthy();
    expect(listSpy).toHaveBeenCalledTimes(1);
    fireEvent.press(retry);
    // Pressing Retry triggers refetch → a second call to listBlocked.
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
  });

  it('shows the loader header (pending) when nothing is seeded', () => {
    const { getByText } = renderScreen(<BlockedUsersScreen />);
    // Header title is always present; with an empty cache the query is pending
    // and the Loader renders below it — the screen mounts without crashing.
    expect(getByText('Blocked accounts')).toBeTruthy();
  });
});
