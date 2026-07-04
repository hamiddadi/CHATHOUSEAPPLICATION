/**
 * AdminAuditLogScreen render tests. No screen props. The log is now cursor-
 * paginated + filterable by action: data lives at
 * `adminKeys.auditLogInfinite({ limit: 100, action: undefined })` as react-query
 * `InfiniteData` (pages of `Paginated<AdminAuditLogEntry>`). We exercise the
 * back arrow, the action filter chips, and cursor pagination.
 */
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { adminKeys } from '../hooks/useAdmin';
import { adminService } from '../services/adminService';
import type { AdminAuditLogEntry, Paginated } from '../types/admin.types';
import { makeNavigationSpy } from '../../../test-utils/navigationMock';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../test-utils/renderScreen';
import { AdminAuditLogScreen } from './AdminAuditLogScreen';

const fakeEntry = (overrides: Partial<AdminAuditLogEntry> = {}): AdminAuditLogEntry => ({
  id: 'a-1',
  actorId: 'admin-1',
  actor: { id: 'admin-1', username: 'rootadmin', displayName: 'Root Admin', avatarUrl: null },
  action: 'USER_SUSPENDED',
  targetUserId: 'u-9',
  targetUser: { id: 'u-9', username: 'baduser', displayName: 'Bad User', avatarUrl: null },
  targetRoomId: null,
  targetType: 'USER',
  targetId: 'u-9',
  metadata: { reason: 'spam', until: new Date(0).toISOString() },
  ip: '127.0.0.1',
  userAgent: 'jest',
  createdAt: new Date(0).toISOString(),
  ...overrides,
});

// The screen's default query params (no filter → action: undefined).
const DEFAULT_PARAMS = { limit: 100, action: undefined };

const seedLog = (
  entries: AdminAuditLogEntry[],
  params: Record<string, unknown> = DEFAULT_PARAMS,
) => {
  const page: Paginated<AdminAuditLogEntry> = {
    data: entries,
    nextCursor: null,
    hasMore: false,
  };
  return [
    {
      key: [...adminKeys.auditLogInfinite(params)],
      data: { pages: [page], pageParams: [undefined] },
    },
  ];
};

describe('AdminAuditLogScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts and renders a seeded audit entry', () => {
    const { getByText, toJSON } = renderScreen(<AdminAuditLogScreen />, {
      seedQueryData: seedLog([fakeEntry()]),
    });
    expect(toJSON()).toBeTruthy();
    // The action label for USER_SUSPENDED resolves via i18n; the actor handle
    // is rendered verbatim and is a stable anchor.
    expect(getByText('@rootadmin')).toBeTruthy();
  });

  it('renders the empty state (crash-free) when there are no entries', () => {
    const { getByText } = renderScreen(<AdminAuditLogScreen />, {
      seedQueryData: seedLog([]),
    });
    expect(getByText('No entries')).toBeTruthy();
  });

  it('the AdminHeader back button calls navigation.goBack', () => {
    const navigation = makeNavigationSpy();
    const { getByLabelText } = renderScreen(<AdminAuditLogScreen />, {
      navigation,
      seedQueryData: seedLog([fakeEntry()]),
    });
    // AdminHeader renders a "Retour" (back) Pressable wired to useNavigation.
    fireEvent.press(getByLabelText('Retour'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('tapping an action filter chip requeries with that action', async () => {
    // Selecting "User suspended" must refetch scoped to USER_SUSPENDED.
    const listSpy = jest
      .spyOn(adminService, 'listAuditLog')
      .mockResolvedValue({ data: [fakeEntry({ id: 'flt-1' })], nextCursor: null, hasMore: false });

    const { getByLabelText } = renderScreen(<AdminAuditLogScreen />, {
      seedQueryData: seedLog([fakeEntry()]),
    });

    // Chip label comes from the shared action i18n map.
    fireEvent.press(getByLabelText('User suspended'));

    await waitFor(() =>
      expect(listSpy).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_SUSPENDED', limit: 100 }),
      ),
    );
  });

  it('fetches the next cursor page on end-reached, revealing page-2 entries', async () => {
    const page1: Paginated<AdminAuditLogEntry> = {
      data: [
        fakeEntry({
          id: 'a-1',
          actor: { id: 'x', username: 'page1actor', displayName: null, avatarUrl: null },
        }),
      ],
      nextCursor: 'CURSOR_2',
      hasMore: true,
    };
    const listSpy = jest.spyOn(adminService, 'listAuditLog').mockResolvedValue({
      data: [
        fakeEntry({
          id: 'a-2',
          actor: { id: 'y', username: 'page2actor', displayName: null, avatarUrl: null },
        }),
      ],
      nextCursor: null,
      hasMore: false,
    });

    const { getByTestId, queryByText, getByText } = renderScreen(<AdminAuditLogScreen />, {
      seedQueryData: [
        {
          key: [...adminKeys.auditLogInfinite(DEFAULT_PARAMS)],
          data: { pages: [page1], pageParams: [undefined] },
        },
      ],
    });

    expect(queryByText('@page2actor')).toBeNull();
    fireEvent(getByTestId('admin-audit-list'), 'onEndReached');

    await waitFor(() =>
      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'CURSOR_2' })),
    );
    await waitFor(() => expect(getByText('@page2actor')).toBeTruthy());
  });
});
