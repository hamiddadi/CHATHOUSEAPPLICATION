/**
 * AdminAuditLogScreen render tests. No screen props; read-only surface (the only
 * interactive control is AdminHeader's back arrow, exercised here). Data lives
 * at `adminKeys.auditLog({ limit: 100 })` as Paginated<AdminAuditLogEntry>.
 */
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { adminKeys } from '../hooks/useAdmin';
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

const seedLog = (entries: AdminAuditLogEntry[]) => {
  const page: Paginated<AdminAuditLogEntry> = {
    data: entries,
    nextCursor: null,
    hasMore: false,
  };
  return [{ key: [...adminKeys.auditLog({ limit: 100 })], data: page }];
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
});
