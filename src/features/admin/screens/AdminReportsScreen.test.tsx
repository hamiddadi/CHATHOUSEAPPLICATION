/**
 * AdminReportsScreen render + button tests. No screen props (AdminHeader pulls
 * navigation from useNavigation via the harness). Data lives at
 * `adminKeys.reports({ status: 'open' })` — the default tab. We seed an open
 * report so the Resolve/Dismiss action buttons render, then assert those open
 * the confirm Alert, and that switching tabs re-renders crash-free.
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent } from '@testing-library/react-native';
import { adminKeys } from '../hooks/useAdmin';
import type { AdminReport, Paginated } from '../types/admin.types';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../test-utils/renderScreen';
import { AdminReportsScreen } from './AdminReportsScreen';

const fakeReport = (overrides: Partial<AdminReport> = {}): AdminReport => ({
  id: 'r-1',
  reporterId: 'rep-1',
  reporter: { id: 'rep-1', username: 'reporter', displayName: 'Reporter', avatarUrl: null },
  reported: { id: 'rep-2', username: 'baduser', displayName: 'Bad User', avatarUrl: null },
  reportedRoom: null,
  targetKind: 'USER',
  reason: 'SPAM',
  details: 'They keep spamming the room.',
  resolvedAt: null,
  createdAt: new Date(0).toISOString(),
  ...overrides,
});

const seedReports = (reports: AdminReport[], status: 'open' | 'resolved' | 'all' = 'open') => {
  const page: Paginated<AdminReport> = { data: reports, nextCursor: null, hasMore: false };
  return [{ key: [...adminKeys.reports({ status })], data: page }];
};

describe('AdminReportsScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts and renders the tab bar + a seeded report', () => {
    const { getByText, toJSON } = renderScreen(<AdminReportsScreen />, {
      seedQueryData: seedReports([fakeReport()]),
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('Open')).toBeTruthy();
    expect(getByText('Target : Bad User')).toBeTruthy();
  });

  it('the Resolve action opens the confirm Alert', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByText } = renderScreen(<AdminReportsScreen />, {
      seedQueryData: seedReports([fakeReport()]),
    });
    fireEvent.press(getByText('Resolve'));
    expect(alertSpy).toHaveBeenCalled();
  });

  it('the Dismiss action opens the confirm Alert', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByText } = renderScreen(<AdminReportsScreen />, {
      seedQueryData: seedReports([fakeReport()]),
    });
    fireEvent.press(getByText('Dismiss'));
    expect(alertSpy).toHaveBeenCalled();
  });

  it('switching to the "Resolved" tab re-renders crash-free (empty state)', () => {
    const { getByText, toJSON } = renderScreen(<AdminReportsScreen />, {
      seedQueryData: seedReports([fakeReport()]),
    });
    fireEvent.press(getByText('Resolved'));
    // The resolved tab has no seeded data → loader/empty, but no crash.
    expect(toJSON()).toBeTruthy();
  });

  it('renders the empty state (crash-free) when the open tab has no reports', () => {
    const { getByText } = renderScreen(<AdminReportsScreen />, {
      seedQueryData: seedReports([]),
    });
    expect(getByText('Nothing here')).toBeTruthy();
  });
});
