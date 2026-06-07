import React from 'react';
import { renderScreen, screen, fireEvent } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useRecentReplays } from '../../hooks/useRecordings';
import type { Replay } from '../../services/recordingService';
import { ReplaysScreen } from './ReplaysScreen';

// ReplayPlayer pulls in expo-audio (a native module not covered by the global
// mocks); replace it with an inert stub so the row renders under node/jest.
jest.mock('../../components/ReplayPlayer', () => {
  const { View } = jest.requireActual('react-native');
  const ReplayPlayerMock: React.FC<{ url: string; durationMs: number | null }> = () => (
    <View accessibilityLabel="replay-player" />
  );
  return { __esModule: true, default: ReplayPlayerMock };
});

// Keep recordingKeys real, override only the data hook.
jest.mock('../../hooks/useRecordings', () => {
  const actual = jest.requireActual('../../hooks/useRecordings');
  return { ...actual, useRecentReplays: jest.fn() };
});

const mockUseRecentReplays = useRecentReplays as unknown as jest.Mock;

type QueryLike = {
  data: Replay[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: jest.Mock;
  isRefetching: boolean;
  isFetching: boolean;
};

const queryState = (over: Partial<QueryLike> = {}): QueryLike => ({
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  refetch: jest.fn(),
  isRefetching: false,
  isFetching: false,
  ...over,
});

const replay: Replay = {
  id: 'rep1',
  roomId: 'room1',
  fileUrl: 'https://cdn.example.com/rep1.m4a',
  durationMs: 125_000,
  createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  roomTitle: 'Building in public',
  host: {
    id: 'u1',
    username: 'alice',
    displayName: 'Alice Doe',
    avatarUrl: null,
  },
};

describe('ReplaysScreen', () => {
  beforeEach(() => {
    mockUseRecentReplays.mockReset();
  });

  it('renders the header title and back control', () => {
    mockUseRecentReplays.mockReturnValue(queryState({ data: [] }));
    renderScreen(<ReplaysScreen />);
    expect(screen.getByText(i18n.t('replays.title'))).toBeTruthy();
    expect(screen.getByLabelText('Back')).toBeTruthy();
  });

  it('shows the loader while replays are loading', () => {
    mockUseRecentReplays.mockReturnValue(queryState({ isLoading: true }));
    renderScreen(<ReplaysScreen />);
    expect(screen.getByLabelText(i18n.t('common.loading'))).toBeTruthy();
  });

  it('shows the empty state when there are no replays', () => {
    mockUseRecentReplays.mockReturnValue(queryState({ data: [] }));
    renderScreen(<ReplaysScreen />);
    expect(screen.getByText(i18n.t('replays.emptyTitle'))).toBeTruthy();
    expect(screen.getByText(i18n.t('replays.emptyBody'))).toBeTruthy();
  });

  it('renders a replay card with its room title and host meta', () => {
    mockUseRecentReplays.mockReturnValue(queryState({ data: [replay] }));
    renderScreen(<ReplaysScreen />);
    expect(screen.getByText('Building in public')).toBeTruthy();
    expect(screen.getByText(/Alice Doe/)).toBeTruthy();
    expect(screen.getByLabelText('replay-player')).toBeTruthy();
  });

  it('falls back to the untitled label when a replay has no room title', () => {
    const untitled: Replay = { ...replay, id: 'rep2', roomTitle: null };
    mockUseRecentReplays.mockReturnValue(queryState({ data: [untitled] }));
    renderScreen(<ReplaysScreen />);
    expect(screen.getByText(i18n.t('replays.untitled'))).toBeTruthy();
  });

  it('goes back when the back button is pressed', () => {
    mockUseRecentReplays.mockReturnValue(queryState({ data: [] }));
    const { navigation } = renderScreen(<ReplaysScreen />);
    fireEvent.press(screen.getByLabelText('Back'));
    expect(navigation.goBack).toHaveBeenCalled();
  });
});
