import React from 'react';
import { renderScreen, screen } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useAdminAuditLog } from '../hooks/useAdmin';
import type { AdminAuditLogEntry, Paginated } from '../types/admin.types';
import { AdminAuditLogScreen } from './AdminAuditLogScreen';

jest.mock('../hooks/useAdmin', () => {
  const actual = jest.requireActual('../hooks/useAdmin');
  return { ...actual, useAdminAuditLog: jest.fn() };
});

const mockUseAdminAuditLog = useAdminAuditLog as jest.Mock;

const queryState = (
  over: Partial<ReturnType<typeof useAdminAuditLog>>,
): ReturnType<typeof useAdminAuditLog> =>
  ({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
    isRefetching: false,
    isFetching: false,
    error: null,
    ...over,
  }) as ReturnType<typeof useAdminAuditLog>;

const entry: AdminAuditLogEntry = {
  id: 'a1',
  actorId: 'u1',
  actor: {
    id: 'u1',
    username: 'moderator',
    displayName: 'Mod One',
    avatarUrl: null,
  },
  action: 'USER_SUSPENDED',
  targetUserId: 'u2',
  targetUser: {
    id: 'u2',
    username: 'target',
    displayName: 'Target Two',
    avatarUrl: null,
  },
  targetRoomId: null,
  targetType: null,
  targetId: null,
  metadata: { reason: 'spam' },
  ip: '127.0.0.1',
  userAgent: null,
  createdAt: '2024-01-31T13:05:00.000Z',
};

const paginated = (items: AdminAuditLogEntry[]): Paginated<AdminAuditLogEntry> => ({
  data: items,
  nextCursor: null,
  hasMore: false,
});

describe('AdminAuditLogScreen', () => {
  beforeEach(() => {
    mockUseAdminAuditLog.mockReset();
  });

  it('renders the header title in the loading state', () => {
    mockUseAdminAuditLog.mockReturnValue(queryState({ isLoading: true }));
    renderScreen(<AdminAuditLogScreen />);
    expect(screen.getByText(i18n.t('admin.audit.title'))).toBeTruthy();
    expect(screen.getByLabelText(i18n.t('common.loading', 'Loading…'))).toBeTruthy();
  });

  it('shows the error state when the query errors', () => {
    mockUseAdminAuditLog.mockReturnValue(queryState({ isError: true }));
    renderScreen(<AdminAuditLogScreen />);
    expect(screen.getByText(i18n.t('admin.audit.errorTitle'))).toBeTruthy();
    expect(screen.getByText(i18n.t('admin.audit.errorBody'))).toBeTruthy();
  });

  it('shows the empty state when loaded with no entries', () => {
    mockUseAdminAuditLog.mockReturnValue(queryState({ data: paginated([]) }));
    renderScreen(<AdminAuditLogScreen />);
    expect(screen.getByText(i18n.t('admin.audit.emptyTitle'))).toBeTruthy();
    expect(screen.getByText(i18n.t('admin.audit.emptyBody'))).toBeTruthy();
  });

  it('renders an audit entry row when data is present', () => {
    mockUseAdminAuditLog.mockReturnValue(queryState({ data: paginated([entry]) }));
    renderScreen(<AdminAuditLogScreen />);
    expect(screen.getByText(i18n.t('admin.audit.roles.suspended'))).toBeTruthy();
    expect(screen.getByText('@moderator')).toBeTruthy();
    expect(screen.getByText('@target')).toBeTruthy();
  });

  it('requests the audit log with a limit of 100', () => {
    mockUseAdminAuditLog.mockReturnValue(queryState({ data: paginated([]) }));
    renderScreen(<AdminAuditLogScreen />);
    expect(mockUseAdminAuditLog).toHaveBeenCalledWith({ limit: 100 });
  });
});
