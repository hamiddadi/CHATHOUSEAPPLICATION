/**
 * Render-test for ExtActivityFeedScreen. The screen fetches via activityApi.list
 * on mount and live-prepends from socket aliases. We mock activityApi (so the
 * list is deterministic and offline) and stub useExtSocketAliases (no live
 * socket under jest), then exercise the tab filters, "Mark all read", and a row
 * tap. Native modules are globally mocked in jest-setup.
 */
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { activityApi, type ActivityItem } from '../api/activityApi';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../test-utils/renderScreen';
import { ExtActivityFeedScreen } from './ExtActivityFeedScreen';

// Self-contained factories (the jest.fn()s live inside, so the factory references
// no out-of-scope vars) — we read the mocks back off the mocked module below.
jest.mock('../api/activityApi', () => ({
  activityApi: {
    list: jest.fn(),
    markRead: jest.fn().mockResolvedValue(undefined),
    markAllRead: jest.fn().mockResolvedValue(undefined),
  },
}));
// No live socket under jest — the alias subscriptions are inert.
jest.mock('../hooks/useExtSocketAliases', () => ({ useExtSocketAliases: () => undefined }));

const mockList = activityApi.list as jest.Mock;
const mockMarkRead = activityApi.markRead as jest.Mock;
const mockMarkAllRead = activityApi.markAllRead as jest.Mock;

const makeItem = (overrides: Partial<ActivityItem> = {}): ActivityItem => ({
  id: 'act-1',
  type: 'ROOM_STARTED',
  title: 'Jane Doe',
  body: 'started "Friday standup"',
  data: { roomId: 'r-1' },
  targetId: 'r-1',
  targetType: 'room',
  actor: { id: 'jane', username: 'jane', displayName: 'Jane Doe', avatarUrl: null },
  isRead: false,
  createdAt: new Date('2024-03-01T00:00:00.000Z').toISOString(),
  ...overrides,
});

describe('ExtActivityFeedScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
    mockList.mockResolvedValue([makeItem()]);
  });
  afterEach(() => {
    resetAuth();
    jest.clearAllMocks();
  });

  it('mounts and renders the seeded activity row after the fetch resolves', async () => {
    const { getByText } = renderScreen(<ExtActivityFeedScreen />, {});
    expect(getByText('Activity')).toBeTruthy();
    await waitFor(() => expect(getByText('Jane Doe')).toBeTruthy());
  });

  it('"Mark all read" fires activityApi.markAllRead', async () => {
    const { getByText, getByLabelText } = renderScreen(<ExtActivityFeedScreen />, {});
    await waitFor(() => expect(getByText('Jane Doe')).toBeTruthy());
    fireEvent.press(getByLabelText('Mark all notifications as read'));
    expect(mockMarkAllRead).toHaveBeenCalled();
  });

  it('switching to the "Rooms" tab re-fetches with that filter', async () => {
    const { getByText } = renderScreen(<ExtActivityFeedScreen />, {});
    await waitFor(() => expect(getByText('Jane Doe')).toBeTruthy());
    fireEvent.press(getByText('Rooms'));
    await waitFor(() => expect(mockList).toHaveBeenCalledWith('rooms'));
  });

  it('tapping a row marks it read via activityApi.markRead', async () => {
    const { getByText, getByLabelText } = renderScreen(<ExtActivityFeedScreen />, {});
    await waitFor(() => expect(getByText('Jane Doe')).toBeTruthy());
    fireEvent.press(getByLabelText('Jane Doe — started "Friday standup"'));
    expect(mockMarkRead).toHaveBeenCalledWith('act-1');
  });

  it('shows the empty state when the feed is empty', async () => {
    mockList.mockResolvedValue([]);
    const { getByText } = renderScreen(<ExtActivityFeedScreen />, {});
    await waitFor(() => expect(getByText('No activity yet.')).toBeTruthy());
  });
});
