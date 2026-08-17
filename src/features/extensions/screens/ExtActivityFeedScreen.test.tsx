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

// The first render in this file pays the module-graph/transform cold-start cost
// (a known Windows-jest flake, see the audit note). Give async assertions extra
// headroom so the suite is deterministic instead of racing the 1s waitFor default.
jest.setTimeout(20000);
const WAIT = { timeout: 8000 } as const;

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

const page = (items: ActivityItem[], nextCursor: string | null = null) => ({
  items,
  nextCursor,
  hasMore: nextCursor !== null,
});

describe('ExtActivityFeedScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
    mockList.mockResolvedValue(page([makeItem()]));
  });
  afterEach(() => {
    resetAuth();
    jest.clearAllMocks();
  });

  it('mounts and renders the seeded activity row after the fetch resolves', async () => {
    const { getByText } = renderScreen(<ExtActivityFeedScreen />, {});
    expect(getByText('Activity')).toBeTruthy();
    await waitFor(() => expect(getByText('Jane Doe')).toBeTruthy(), WAIT);
  });

  it('"Mark all read" fires activityApi.markAllRead', async () => {
    const { getByText, getByLabelText } = renderScreen(<ExtActivityFeedScreen />, {});
    await waitFor(() => expect(getByText('Jane Doe')).toBeTruthy(), WAIT);
    fireEvent.press(getByLabelText('Mark all notifications as read'));
    expect(mockMarkAllRead).toHaveBeenCalled();
  });

  it('switching to the "Rooms" tab re-fetches with that filter', async () => {
    const { getByText } = renderScreen(<ExtActivityFeedScreen />, {});
    await waitFor(() => expect(getByText('Jane Doe')).toBeTruthy(), WAIT);
    fireEvent.press(getByText('Rooms'));
    await waitFor(() => expect(mockList).toHaveBeenCalledWith('rooms'), WAIT);
  });

  it('tapping a row marks it read via activityApi.markRead', async () => {
    const { getByText, getByLabelText } = renderScreen(<ExtActivityFeedScreen />, {});
    await waitFor(() => expect(getByText('Jane Doe')).toBeTruthy(), WAIT);
    fireEvent.press(getByLabelText('Jane Doe — started "Friday standup"'));
    expect(mockMarkRead).toHaveBeenCalledWith('act-1');
  });

  it('shows the empty state when the feed is empty', async () => {
    mockList.mockResolvedValue(page([]));
    const { getByText } = renderScreen(<ExtActivityFeedScreen />, {});
    await waitFor(() => expect(getByText('No activity yet.')).toBeTruthy(), WAIT);
  });

  it('shows an error state with a working Retry when the first load fails', async () => {
    mockList.mockRejectedValueOnce(new Error('offline'));
    const { getByText, getByLabelText } = renderScreen(<ExtActivityFeedScreen />, {});
    // First load failed → error copy, NOT the "no activity" empty state.
    await waitFor(() => expect(getByText("Couldn't load your activity.")).toBeTruthy(), WAIT);
    // Retry re-fetches; now the list resolves with a row.
    mockList.mockResolvedValueOnce(page([makeItem()]));
    fireEvent.press(getByLabelText('Retry'));
    await waitFor(() => expect(getByText('Jane Doe')).toBeTruthy(), WAIT);
  });

  it('onEndReached loads the next page using the server-provided opaque cursor', async () => {
    const firstPage = Array.from({ length: 50 }, (_, i) =>
      makeItem({
        id: `a-${i}`,
        title: `User ${i}`,
        createdAt: new Date(2024, 0, 1, 0, 0, 50 - i).toISOString(),
      }),
    );
    const opaqueCursor = 'v1.WyIyMDI0LTAxLTAxVDAwOjAwOjAxLjAwMFoiLCJhLTQ5Il0';
    mockList.mockResolvedValueOnce(page(firstPage, opaqueCursor));
    const { getByText, UNSAFE_getByType } = renderScreen(<ExtActivityFeedScreen />, {});
    await waitFor(() => expect(getByText('User 0')).toBeTruthy(), WAIT);

    mockList.mockResolvedValueOnce(page([makeItem({ id: 'page2', title: 'Second Page User' })]));
    // Drive the FlatList's onEndReached directly.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { FlatList } = require('react-native');
    const list = UNSAFE_getByType(FlatList);
    list.props.onEndReached();

    await waitFor(() => expect(mockList).toHaveBeenCalledWith('all', opaqueCursor), WAIT);
    // The next page is appended to the feed data (FlatList windowing may not
    // render the 51st row in jsdom, so assert against the data prop directly).
    await waitFor(() => {
      const data = UNSAFE_getByType(FlatList).props.data as { id: string }[];
      expect(data.some(i => i.id === 'page2')).toBe(true);
    }, WAIT);
  });

  it('"Mark all read" rolls back the read state when the API call fails', async () => {
    mockList.mockResolvedValue(page([makeItem({ id: 'act-1', isRead: false })]));
    mockMarkAllRead.mockRejectedValueOnce(new Error('boom'));
    const { getByText, getByLabelText, getByTestId, queryByTestId } = renderScreen(
      <ExtActivityFeedScreen />,
      {},
    );
    await waitFor(() => expect(getByText('Jane Doe')).toBeTruthy(), WAIT);
    // The unread dot is rendered while the row is unread.
    expect(getByTestId('unread-dot-act-1')).toBeTruthy();

    fireEvent.press(getByLabelText('Mark all notifications as read'));
    await waitFor(() => expect(mockMarkAllRead).toHaveBeenCalled(), WAIT);
    // markAllRead rejected → the optimistic read-flip must revert, so the
    // unread dot is back (had rollback not fired, the row would stay "read"
    // and the dot would be gone).
    await waitFor(() => expect(queryByTestId('unread-dot-act-1')).toBeTruthy(), WAIT);
  });

  it('"Mark all read" clears the unread dot on success', async () => {
    mockList.mockResolvedValue(page([makeItem({ id: 'act-1', isRead: false })]));
    mockMarkAllRead.mockResolvedValueOnce(undefined);
    const { getByText, getByLabelText, getByTestId, queryByTestId } = renderScreen(
      <ExtActivityFeedScreen />,
      {},
    );
    await waitFor(() => expect(getByText('Jane Doe')).toBeTruthy(), WAIT);
    expect(getByTestId('unread-dot-act-1')).toBeTruthy();
    fireEvent.press(getByLabelText('Mark all notifications as read'));
    await waitFor(() => expect(queryByTestId('unread-dot-act-1')).toBeNull(), WAIT);
  });
});
