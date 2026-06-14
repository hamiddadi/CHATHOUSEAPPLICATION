/**
 * AdminRoomsScreen render + button tests. No screen props. Data is a plain
 * AdminRoom[] (not paginated) at `adminKeys.rooms({ live: true })`. We seed a
 * live room so the "Close room" button is enabled, then assert pressing it goes
 * through `promptForReason` (Alert.prompt on iOS, Alert.alert via androidConfirm
 * otherwise) without crashing.
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent } from '@testing-library/react-native';
import { adminKeys } from '../hooks/useAdmin';
import type { AdminRoom } from '../types/admin.types';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../test-utils/renderScreen';
import { AdminRoomsScreen } from './AdminRoomsScreen';

const fakeRoom = (overrides: Partial<AdminRoom> = {}): AdminRoom => ({
  id: 'room-1',
  title: 'Late Night Debate',
  isLive: true,
  isPrivate: false,
  participantCount: 12,
  hostId: 'host-1',
  host: { id: 'host-1', username: 'hosty', displayName: 'Hosty', avatarUrl: null },
  createdAt: new Date(0).toISOString(),
  endedAt: null,
  ...overrides,
});

const seedRooms = (rooms: AdminRoom[]) => [
  { key: [...adminKeys.rooms({ live: true })], data: rooms },
];

describe('AdminRoomsScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts and lists a seeded live room', () => {
    const { getByText, toJSON } = renderScreen(<AdminRoomsScreen />, {
      seedQueryData: seedRooms([fakeRoom()]),
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('Late Night Debate')).toBeTruthy();
  });

  it('the "Close room" button on a live room opens the prompt/confirm flow', () => {
    const promptSpy = jest
      .spyOn(Alert, 'prompt' as never)
      .mockImplementation(() => undefined as never);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText } = renderScreen(<AdminRoomsScreen />, {
      seedQueryData: seedRooms([fakeRoom()]),
    });
    fireEvent.press(getByLabelText('Close room Late Night Debate'));
    // This screen passes `androidConfirm`, so the no-prompt path shows an Alert.
    // Either Alert.prompt (iOS) or Alert.alert (androidConfirm) must have fired.
    expect(promptSpy.mock.calls.length + alertSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('renders the empty state (crash-free) when there are no live rooms', () => {
    const { getByText } = renderScreen(<AdminRoomsScreen />, {
      seedQueryData: seedRooms([]),
    });
    expect(getByText('No active rooms')).toBeTruthy();
  });
});
