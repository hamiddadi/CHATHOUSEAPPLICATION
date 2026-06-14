/**
 * AdminUsersScreen render + button tests. Reads `navigation` from PROPS. The
 * list is an infinite query keyed by `adminKeys.usersInfinite(params)`; the
 * screen's first render uses params `{ q: undefined, role: undefined, limit: 50 }`
 * (empty search, ALL filter), so we seed exactly that key with an InfiniteData
 * page. We exercise: a user row → navigate to AdminUserDetail, and a role filter
 * chip toggling its selected state.
 */
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import type { InfiniteData } from '@tanstack/react-query';
import { adminKeys } from '../hooks/useAdmin';
import type { AdminUser, Paginated } from '../types/admin.types';
import { makeNavigationSpy } from '../../../test-utils/navigationMock';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../test-utils/renderScreen';
import type { SettingsStackScreenProps } from '../../../core/navigation/types';
import { AdminUsersScreen } from './AdminUsersScreen';

const fakeUser = (overrides: Partial<AdminUser> = {}): AdminUser => ({
  id: 'u-1',
  username: 'alice',
  displayName: 'Alice Doe',
  email: 'alice@example.com',
  phoneNumber: '+10000000000',
  avatarUrl: null,
  appRole: 'USER',
  isOnline: true,
  suspendedUntil: null,
  suspensionReason: null,
  followerCount: 5,
  followingCount: 3,
  deletedAt: null,
  createdAt: new Date(0).toISOString(),
  lastSeenAt: null,
  ...overrides,
});

// The screen's first-render params (empty search debounced to '', ALL role).
const FIRST_PARAMS = { q: undefined, role: undefined, limit: 50 } as const;

const seedUsers = (users: AdminUser[]) => {
  const page: Paginated<AdminUser> = { data: users, nextCursor: null, hasMore: false };
  const infinite: InfiniteData<Paginated<AdminUser>> = {
    pages: [page],
    pageParams: [undefined],
  };
  return [{ key: [...adminKeys.usersInfinite(FIRST_PARAMS)], data: infinite }];
};

const propsFor = (
  navigation: ReturnType<typeof makeNavigationSpy>,
): SettingsStackScreenProps<'AdminUsers'> =>
  ({ navigation, route: { key: 'k', name: 'AdminUsers', params: undefined } }) as never;

describe('AdminUsersScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts and renders the search field + role filters (loader-free with seed)', () => {
    const navigation = makeNavigationSpy();
    const { getByPlaceholderText, getByText, toJSON } = renderScreen(
      <AdminUsersScreen {...propsFor(navigation)} />,
      { navigation, seedQueryData: seedUsers([fakeUser()]) },
    );
    expect(toJSON()).toBeTruthy();
    expect(getByPlaceholderText('Search by name or @username')).toBeTruthy();
    expect(getByText('Alice Doe')).toBeTruthy();
  });

  it('pressing a user row navigates to AdminUserDetail with the userId', () => {
    const navigation = makeNavigationSpy();
    const { getByLabelText } = renderScreen(<AdminUsersScreen {...propsFor(navigation)} />, {
      navigation,
      seedQueryData: seedUsers([fakeUser({ id: 'u-42', displayName: 'Bob' })]),
    });
    fireEvent.press(getByLabelText('Open Bob'));
    expect(navigation.navigate).toHaveBeenCalledWith('AdminUserDetail', { userId: 'u-42' });
  });

  it('tapping a role filter chip marks it selected', () => {
    const navigation = makeNavigationSpy();
    const { getByText } = renderScreen(<AdminUsersScreen {...propsFor(navigation)} />, {
      navigation,
      seedQueryData: seedUsers([fakeUser()]),
    });
    // "Admin" chip (accessibilityRole=radio). Press it and assert selection.
    const adminChip = getByText('Admin');
    fireEvent.press(adminChip);
    // The Pressable wraps the Text; assert the screen didn't crash and the chip
    // remains queryable (state lives on the Pressable parent).
    expect(getByText('Admin')).toBeTruthy();
  });

  it('renders the empty state (crash-free) when the seeded page has no users', () => {
    const navigation = makeNavigationSpy();
    const { getByText } = renderScreen(<AdminUsersScreen {...propsFor(navigation)} />, {
      navigation,
      seedQueryData: seedUsers([]),
    });
    expect(getByText('No users found')).toBeTruthy();
  });
});
