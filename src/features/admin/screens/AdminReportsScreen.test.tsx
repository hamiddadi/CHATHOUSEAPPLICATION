/**
 * AdminReportsScreen render + button tests. No screen props (AdminHeader pulls
 * navigation from useNavigation via the harness). The queue is now cursor-
 * paginated: data lives at `adminKeys.reportsInfinite({ status: 'open' })` — the
 * default tab — as react-query `InfiniteData` (pages of `Paginated<AdminReport>`).
 * We seed an open report so the Resolve/Dismiss action buttons render, then
 * assert those open the confirm Alert, and that switching tabs re-renders
 * crash-free.
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { adminKeys } from '../hooks/useAdmin';
import { adminService } from '../services/adminService';
import type { AdminReport, Paginated } from '../types/admin.types';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../test-utils/renderScreen';
import { AdminReportsScreen } from './AdminReportsScreen';

const fakeReport = (overrides: Partial<AdminReport> = {}): AdminReport => ({
  id: 'r-1',
  reporterId: 'rep-1',
  reporter: { id: 'rep-1', username: 'reporter', displayName: 'Reporter', avatarUrl: null },
  reported: { id: 'rep-2', username: 'baduser', displayName: 'Bad User', avatarUrl: null },
  reportedRoom: null,
  contentAuthor: null,
  targetKind: 'USER',
  reportedMessageId: null,
  reportedGroupMessageId: null,
  reportedRoomMessageId: null,
  contentSnapshot: null,
  contentAudioUrl: null,
  contentAudioDurationMs: null,
  contentKind: null,
  contentCreatedAt: null,
  contentContextId: null,
  contentContextSnapshot: null,
  reason: 'SPAM',
  details: 'They keep spamming the room.',
  resolvedAt: null,
  createdAt: new Date(0).toISOString(),
  ...overrides,
});

const seedReports = (reports: AdminReport[], status: 'open' | 'resolved' | 'all' = 'open') => {
  const page: Paginated<AdminReport> = { data: reports, nextCursor: null, hasMore: false };
  // The screen uses useInfiniteQuery → seed react-query InfiniteData.
  return [
    {
      key: [...adminKeys.reportsInfinite({ status })],
      data: { pages: [page], pageParams: [undefined] },
    },
  ];
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

  it('shows the preserved message evidence for a content report', () => {
    const contentAuthor = {
      id: 'author-1',
      username: 'author',
      displayName: 'Content Author',
      avatarUrl: null,
    };
    const report = fakeReport({
      reported: null,
      contentAuthor,
      targetKind: 'DIRECT_MESSAGE',
      reportedMessageId: 'message-1',
      contentSnapshot: 'preserved abusive content',
      contentKind: 'TEXT',
      contentCreatedAt: new Date(1).toISOString(),
    });
    const { getByText } = renderScreen(<AdminReportsScreen />, {
      seedQueryData: seedReports([report]),
    });

    expect(getByText('Target : Content Author')).toBeTruthy();
    expect(getByText('Reported message')).toBeTruthy();
    expect(getByText('preserved abusive content')).toBeTruthy();
  });

  it('offers playback for preserved voice evidence without displaying its capability URL', () => {
    const evidenceUrl = 'https://api.test/media/private-id/signed-capability';
    const report = fakeReport({
      reported: null,
      contentAuthor: {
        id: 'author-voice',
        username: 'voice-author',
        displayName: 'Voice Author',
        avatarUrl: null,
      },
      targetKind: 'GROUP_MESSAGE',
      reportedGroupMessageId: 'voice-message-1',
      contentKind: 'VOICE',
      contentAudioUrl: evidenceUrl,
      contentAudioDurationMs: 12_500,
      contentCreatedAt: new Date(2).toISOString(),
    });
    const { getByLabelText, getByText, queryByText } = renderScreen(<AdminReportsScreen />, {
      seedQueryData: seedReports([report]),
    });

    expect(getByText('Voice message')).toBeTruthy();
    expect(getByLabelText('Play voice message')).toBeTruthy();
    expect(queryByText(evidenceUrl)).toBeNull();
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

  it('fetches the next cursor page on end-reached, revealing page-2 reports', async () => {
    // Page 1 seeded with hasMore + a nextCursor. onEndReached must call the
    // service with that cursor and append the returned page (previously
    // impossible: the flat useQuery ignored the cursor).
    const page1: Paginated<AdminReport> = {
      data: [fakeReport({ id: 'r-1', reported: null, details: 'page one report' })],
      nextCursor: 'CURSOR_2',
      hasMore: true,
    };
    const page2Report = fakeReport({ id: 'r-2', reported: null, details: 'page two report' });
    const listSpy = jest
      .spyOn(adminService, 'listReports')
      .mockResolvedValue({ data: [page2Report], nextCursor: null, hasMore: false });

    const { getByTestId, queryByText, getByText } = renderScreen(<AdminReportsScreen />, {
      seedQueryData: [
        {
          key: [...adminKeys.reportsInfinite({ status: 'open' })],
          data: { pages: [page1], pageParams: [undefined] },
        },
      ],
    });

    // Page 2 not present yet.
    expect(queryByText('“page two report”')).toBeNull();

    // Invoke the FlatList's wired onEndReached handler (scroll-driven in the
    // app; called directly here for a deterministic assertion).
    fireEvent(getByTestId('admin-reports-list'), 'onEndReached');

    await waitFor(() =>
      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'CURSOR_2' })),
    );
    await waitFor(() => expect(getByText('“page two report”')).toBeTruthy());
  });
});
