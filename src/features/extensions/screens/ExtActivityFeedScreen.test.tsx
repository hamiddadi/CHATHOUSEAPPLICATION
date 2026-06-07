import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { activityApi, type ActivityItem } from '../api/activityApi';
import { ExtActivityFeedScreen } from './ExtActivityFeedScreen';

// The screen subscribes to realtime socket aliases on mount. Stub the hook so
// no real socket connection is attempted under jest.
jest.mock('../hooks/useExtSocketAliases', () => ({
  useExtSocketAliases: jest.fn(),
}));

// activityApi is a plain object (not a hook). Mock the whole module so the
// screen's fetch/mark calls resolve deterministically without touching axios.
jest.mock('../api/activityApi', () => ({
  activityApi: {
    list: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
  },
}));

const mockList = activityApi.list as jest.Mock;
const mockMarkRead = activityApi.markRead as jest.Mock;
const mockMarkAllRead = activityApi.markAllRead as jest.Mock;

const makeItem = (over: Partial<ActivityItem> = {}): ActivityItem => ({
  id: 'n1',
  type: 'ROOM_STARTED',
  title: 'Ada Lovelace',
  body: 'started "Building in public"',
  data: null,
  targetId: 'r1',
  targetType: 'room',
  actor: null,
  isRead: false,
  createdAt: new Date().toISOString(),
  ...over,
});

describe('ExtActivityFeedScreen', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockMarkRead.mockReset().mockResolvedValue(undefined);
    mockMarkAllRead.mockReset().mockResolvedValue(undefined);
    mockList.mockResolvedValue([]);
  });

  it('renders the header title and filter tabs', async () => {
    renderScreen(<ExtActivityFeedScreen />);
    expect(screen.getByText(i18n.t('extensions.activity.title'))).toBeTruthy();
    expect(
      screen.getByLabelText(
        `${i18n.t('extensions.activity.filterA11y')}: ${i18n.t('extensions.activity.filters.all')}`,
      ),
    ).toBeTruthy();
    // Let the mount fetch settle so loading flips off without act() warnings.
    await waitFor(() => expect(mockList).toHaveBeenCalled());
  });

  it('shows the empty state when the feed returns no items', async () => {
    mockList.mockResolvedValue([]);
    renderScreen(<ExtActivityFeedScreen />);
    expect(await screen.findByText(i18n.t('extensions.activity.empty'))).toBeTruthy();
  });

  it('renders feed rows once loaded', async () => {
    const item = makeItem();
    mockList.mockResolvedValue([item]);
    renderScreen(<ExtActivityFeedScreen />);
    expect(await screen.findByLabelText(`${item.title} — ${item.body}`)).toBeTruthy();
  });

  it('keeps the stale (empty) list when the fetch rejects', async () => {
    mockList.mockRejectedValue(new Error('network down'));
    renderScreen(<ExtActivityFeedScreen />);
    // The catch swallows the error and loading still flips off -> empty state.
    expect(await screen.findByText(i18n.t('extensions.activity.empty'))).toBeTruthy();
  });

  it('invokes onTapItem and marks the row read when a row is pressed', async () => {
    const item = makeItem();
    mockList.mockResolvedValue([item]);
    const onTapItem = jest.fn();
    renderScreen(<ExtActivityFeedScreen onTapItem={onTapItem} />);

    const row = await screen.findByLabelText(`${item.title} — ${item.body}`);
    fireEvent.press(row);

    expect(onTapItem).toHaveBeenCalledWith(item);
    await waitFor(() => expect(mockMarkRead).toHaveBeenCalledWith(item.id));
  });

  it('marks all notifications as read from the header action', async () => {
    mockList.mockResolvedValue([makeItem()]);
    renderScreen(<ExtActivityFeedScreen />);
    await screen.findByText(i18n.t('extensions.activity.title'));

    fireEvent.press(screen.getByLabelText(i18n.t('extensions.activity.markAllA11y')));

    await waitFor(() => expect(mockMarkAllRead).toHaveBeenCalledTimes(1));
  });
});
