import React from 'react';
import { Alert } from 'react-native';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useAdminReports, useResolveReport } from '../hooks/useAdmin';
import type { AdminReport, Paginated } from '../types/admin.types';
import { AdminReportsScreen } from './AdminReportsScreen';

jest.mock('../hooks/useAdmin', () => {
  const actual = jest.requireActual('../hooks/useAdmin');
  return {
    ...actual,
    useAdminReports: jest.fn(),
    useResolveReport: jest.fn(),
  };
});

const mockUseAdminReports = useAdminReports as jest.Mock;
const mockUseResolveReport = useResolveReport as jest.Mock;

const queryState = (over: Record<string, unknown> = {}) => ({
  data: undefined,
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
  isRefetching: false,
  isFetching: false,
  error: null,
  ...over,
});

const mutationState = (over: Record<string, unknown> = {}) => ({
  mutate: jest.fn(),
  mutateAsync: jest.fn().mockResolvedValue(undefined),
  isPending: false,
  isError: false,
  reset: jest.fn(),
  variables: undefined,
  ...over,
});

const buildReport = (over: Partial<AdminReport> = {}): AdminReport => ({
  id: 'rep-1',
  reporterId: 'u-reporter',
  reporter: {
    id: 'u-reporter',
    username: 'reporter',
    displayName: 'Reporter',
    avatarUrl: null,
  },
  reported: {
    id: 'u-target',
    username: 'baduser',
    displayName: 'Bad User',
    avatarUrl: null,
  },
  reportedRoom: null,
  targetKind: 'USER',
  reason: 'SPAM',
  details: 'Sending spam links',
  resolvedAt: null,
  createdAt: '2026-06-01T12:00:00.000Z',
  ...over,
});

const paginated = (items: AdminReport[]): Paginated<AdminReport> => ({
  data: items,
  nextCursor: null,
  hasMore: false,
});

describe('AdminReportsScreen', () => {
  beforeEach(() => {
    mockUseAdminReports.mockReset();
    mockUseResolveReport.mockReset();
    mockUseResolveReport.mockReturnValue(mutationState());
  });

  it('renders the header title and tabs without crashing', () => {
    mockUseAdminReports.mockReturnValue(queryState({ data: paginated([]) }));
    renderScreen(<AdminReportsScreen />);

    expect(screen.getByText(i18n.t('admin.reports.title'))).toBeTruthy();
    expect(screen.getByText(i18n.t('admin.reports.tabs.open'))).toBeTruthy();
    expect(screen.getByText(i18n.t('admin.reports.tabs.all'))).toBeTruthy();
  });

  it('shows the loader while reports are loading', () => {
    mockUseAdminReports.mockReturnValue(queryState({ isLoading: true }));
    renderScreen(<AdminReportsScreen />);

    expect(screen.getByLabelText(i18n.t('common.loading'))).toBeTruthy();
  });

  it('shows the error state when the query fails', () => {
    mockUseAdminReports.mockReturnValue(queryState({ isError: true, data: undefined }));
    renderScreen(<AdminReportsScreen />);

    expect(screen.getByText(i18n.t('admin.reports.errorTitle'))).toBeTruthy();
    expect(screen.getByText(i18n.t('admin.reports.errorBody'))).toBeTruthy();
  });

  it('renders the empty state when there are no reports', () => {
    mockUseAdminReports.mockReturnValue(queryState({ data: paginated([]) }));
    renderScreen(<AdminReportsScreen />);

    expect(screen.getByText(i18n.t('admin.reports.emptyTitle'))).toBeTruthy();
    expect(screen.getByText(i18n.t('admin.reports.emptyOpen'))).toBeTruthy();
  });

  it('renders a report row with its action buttons when loaded', async () => {
    mockUseAdminReports.mockReturnValue(queryState({ data: paginated([buildReport()]) }));
    renderScreen(<AdminReportsScreen />);

    expect(await screen.findByLabelText(i18n.t('admin.reports.resolveA11y'))).toBeTruthy();
    expect(screen.getByLabelText(i18n.t('admin.reports.dismissA11y'))).toBeTruthy();
  });

  it('confirms before resolving a report and triggers the mutation on accept', async () => {
    const mutate = jest.fn();
    mockUseResolveReport.mockReturnValue(mutationState({ mutate }));
    mockUseAdminReports.mockReturnValue(queryState({ data: paginated([buildReport()]) }));

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    renderScreen(<AdminReportsScreen />);

    fireEvent.press(await screen.findByLabelText(i18n.t('admin.reports.resolveA11y')));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());

    const buttons = (alertSpy.mock.calls[0]?.[2] ?? []) as { text: string; onPress?: () => void }[];
    const confirmBtn = buttons.find(b => b.text === i18n.t('admin.reports.resolve'));
    confirmBtn?.onPress?.();

    expect(mutate).toHaveBeenCalledWith(
      { reportId: 'rep-1', outcome: 'resolved' },
      expect.anything(),
    );

    alertSpy.mockRestore();
  });
});
