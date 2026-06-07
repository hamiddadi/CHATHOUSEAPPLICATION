import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useAdminUsersInfinite } from '../hooks/useAdmin';
import type { AdminUser } from '../types/admin.types';
import type { SettingsStackScreenProps } from '../../../core/navigation/types';
import { AdminUsersScreen } from './AdminUsersScreen';

jest.mock('../hooks/useAdmin', () => {
  const actual = jest.requireActual('../hooks/useAdmin');
  return { ...actual, useAdminUsersInfinite: jest.fn() };
});

const mockUseAdminUsersInfinite = useAdminUsersInfinite as jest.Mock;

type InfiniteState = ReturnType<typeof useAdminUsersInfinite>;

const infiniteState = (over: Partial<InfiniteState> = {}): InfiniteState =>
  ({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
    isRefetching: false,
    fetchNextPage: jest.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    ...over,
  }) as unknown as InfiniteState;

const makeUser = (over: Partial<AdminUser> = {}): AdminUser => ({
  id: 'u1',
  username: 'janedoe',
  displayName: 'Jane Doe',
  email: 'jane@example.com',
  phoneNumber: null,
  avatarUrl: null,
  appRole: 'USER',
  isOnline: true,
  suspendedUntil: null,
  suspensionReason: null,
  followerCount: 0,
  followingCount: 0,
  deletedAt: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  lastSeenAt: null,
  ...over,
});

const pageOf = (
  users: AdminUser[],
  over: { hasMore?: boolean; nextCursor?: string | null } = {},
) => ({
  pages: [{ data: users, nextCursor: over.nextCursor ?? null, hasMore: over.hasMore ?? false }],
  pageParams: [undefined],
});

// The screen reads `navigation` from props (not useNavigation), so build a spy
// and pass it through. The shape only needs `navigate` for these assertions.
const makeNav = () => {
  const navigate = jest.fn();
  const navigation = {
    navigate,
  } as unknown as SettingsStackScreenProps<'AdminUsers'>['navigation'];
  return { navigation, navigate };
};

describe('AdminUsersScreen', () => {
  beforeEach(() => {
    mockUseAdminUsersInfinite.mockReset();
  });

  it('renders the header title', () => {
    mockUseAdminUsersInfinite.mockReturnValue(infiniteState({ data: pageOf([]) }));
    const { navigation } = makeNav();
    renderScreen(<AdminUsersScreen navigation={navigation} route={{} as never} />);
    expect(screen.getByText(i18n.t('admin.users.title'))).toBeTruthy();
  });

  it('shows a loader while loading', () => {
    mockUseAdminUsersInfinite.mockReturnValue(infiniteState({ isLoading: true }));
    const { navigation } = makeNav();
    renderScreen(<AdminUsersScreen navigation={navigation} route={{} as never} />);
    expect(screen.getByLabelText(i18n.t('common.loading', 'Loading…'))).toBeTruthy();
  });

  it('shows the error state when the query errors', () => {
    mockUseAdminUsersInfinite.mockReturnValue(infiniteState({ isError: true, data: undefined }));
    const { navigation } = makeNav();
    renderScreen(<AdminUsersScreen navigation={navigation} route={{} as never} />);
    expect(screen.getByText(i18n.t('admin.users.errorTitle'))).toBeTruthy();
    expect(screen.getByText(i18n.t('admin.users.errorBody'))).toBeTruthy();
  });

  it('shows the empty state when there are no users', () => {
    mockUseAdminUsersInfinite.mockReturnValue(infiniteState({ data: pageOf([]) }));
    const { navigation } = makeNav();
    renderScreen(<AdminUsersScreen navigation={navigation} route={{} as never} />);
    expect(screen.getByText(i18n.t('admin.users.emptyTitle'))).toBeTruthy();
  });

  it('renders a user row from loaded data', () => {
    mockUseAdminUsersInfinite.mockReturnValue(infiniteState({ data: pageOf([makeUser()]) }));
    const { navigation } = makeNav();
    renderScreen(<AdminUsersScreen navigation={navigation} route={{} as never} />);
    expect(screen.getByLabelText('Open Jane Doe')).toBeTruthy();
    expect(screen.getByText('Jane Doe')).toBeTruthy();
  });

  it('navigates to the user detail when a row is pressed', async () => {
    mockUseAdminUsersInfinite.mockReturnValue(infiniteState({ data: pageOf([makeUser()]) }));
    const { navigation, navigate } = makeNav();
    renderScreen(<AdminUsersScreen navigation={navigation} route={{} as never} />);
    fireEvent.press(screen.getByLabelText('Open Jane Doe'));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('AdminUserDetail', { userId: 'u1' });
    });
  });
});
