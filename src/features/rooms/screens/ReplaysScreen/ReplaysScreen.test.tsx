/**
 * Render test for ReplaysScreen.
 *
 * Mounts the screen, primes the recent-replays query cache so the loader is
 * skipped and the populated FlatList (or its empty state) renders, then
 * exercises the only primary control on the screen: the header back button.
 */
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { recordingKeys } from '../../hooks/useRecordings';
import type { Replay } from '../../services/recordingService';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { ReplaysScreen } from './ReplaysScreen';

const fakeReplay = (overrides: Partial<Replay> = {}): Replay => ({
  id: 'replay-1',
  roomId: 'room-1',
  fileUrl: 'https://cdn.example.com/replay-1.m4a',
  durationMs: 120_000,
  createdAt: new Date(Date.now() - 3_600_000).toISOString(),
  roomTitle: 'A great talk',
  host: { id: 'host-1', username: 'host', displayName: 'Host Person', avatarUrl: null },
  ...overrides,
});

describe('ReplaysScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
  });

  it('mounts and renders the populated replay list when data is primed', () => {
    const { getByText, toJSON } = renderScreen(<ReplaysScreen />, {
      route: { name: 'Replays' },
      seedQueryData: [{ key: [...recordingKeys.recent()], data: [fakeReplay()] }],
    });
    expect(toJSON()).toBeTruthy();
    // Header title + the seeded replay's room title prove we're past the loader.
    expect(getByText('Replays')).toBeTruthy();
    expect(getByText('A great talk')).toBeTruthy();
  });

  it('renders the empty state when there are no replays', () => {
    const { getByText } = renderScreen(<ReplaysScreen />, {
      route: { name: 'Replays' },
      seedQueryData: [{ key: [...recordingKeys.recent()], data: [] }],
    });
    // Empty-state title (replays.emptyTitle) renders past the loader.
    expect(getByText('Replays')).toBeTruthy();
  });

  it('fires navigation.goBack when the header back button is pressed', () => {
    const { navigation, getByLabelText } = renderScreen(<ReplaysScreen />, {
      route: { name: 'Replays' },
      seedQueryData: [{ key: [...recordingKeys.recent()], data: [] }],
    });
    fireEvent.press(getByLabelText('Back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
