/**
 * AdminRoomsScreen render + button tests. No screen props. Data is a plain
 * AdminRoom[] (not paginated) at `adminKeys.rooms({ live: true })`. We seed a
 * live room so the "Close room" button is enabled, then drive the reason prompt:
 * on Android the feature-local modal (the platform where Alert.prompt was a
 * silent no-op) — confirming force-ends the room with the typed reason,
 * cancelling force-ends nothing.
 */
import React from 'react';
import { Alert, Platform } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { adminKeys } from '../hooks/useAdmin';
import { adminService } from '../services/adminService';
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

  describe('force-end flow (Android modal path)', () => {
    const ORIGINAL_OS = Platform.OS;
    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    });
    afterEach(() => {
      Object.defineProperty(Platform, 'OS', { value: ORIGINAL_OS, configurable: true });
    });

    it('"Close room" opens the reason modal; confirming force-ends the room with the typed reason', async () => {
      const forceEndSpy = jest
        .spyOn(adminService, 'forceEndRoom')
        .mockResolvedValue({ ended: true });
      const { getByLabelText, queryByLabelText } = renderScreen(<AdminRoomsScreen />, {
        seedQueryData: seedRooms([fakeRoom()]),
      });

      // Modal not mounted until the row action is tapped.
      expect(queryByLabelText('Are you sure you want to close this room?')).toBeNull();

      fireEvent.press(getByLabelText('Close room Late Night Debate'));
      const field = getByLabelText('Are you sure you want to close this room?');
      fireEvent.changeText(field, 'ToS violation');

      // The modal's confirm button carries the a11y label "Close room" (its
      // confirmLabel) — distinct from the row action "Close room <title>".
      fireEvent.press(getByLabelText('Close room'));
      await waitFor(() => expect(forceEndSpy).toHaveBeenCalledTimes(1));
      expect(forceEndSpy).toHaveBeenCalledWith('room-1', 'ToS violation');
    });

    it('cancelling the reason modal does NOT force-end the room', async () => {
      const forceEndSpy = jest
        .spyOn(adminService, 'forceEndRoom')
        .mockResolvedValue({ ended: true });
      const { getByLabelText, getByText, queryByLabelText } = renderScreen(<AdminRoomsScreen />, {
        seedQueryData: seedRooms([fakeRoom()]),
      });

      fireEvent.press(getByLabelText('Close room Late Night Debate'));
      expect(getByLabelText('Are you sure you want to close this room?')).toBeTruthy();
      fireEvent.press(getByText('Cancel'));

      await waitFor(() =>
        expect(queryByLabelText('Are you sure you want to close this room?')).toBeNull(),
      );
      expect(forceEndSpy).not.toHaveBeenCalled();
    });
  });

  it('the "Close room" button uses the native Alert.prompt on iOS (no modal)', () => {
    const promptSpy = jest
      .spyOn(Alert, 'prompt' as never)
      .mockImplementation(() => undefined as never);
    const { getByLabelText, queryByLabelText } = renderScreen(<AdminRoomsScreen />, {
      seedQueryData: seedRooms([fakeRoom()]),
    });
    fireEvent.press(getByLabelText('Close room Late Night Debate'));
    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(queryByLabelText('Are you sure you want to close this room?')).toBeNull();
  });

  it('renders the empty state (crash-free) when there are no live rooms', () => {
    const { getByText } = renderScreen(<AdminRoomsScreen />, {
      seedQueryData: seedRooms([]),
    });
    expect(getByText('No active rooms')).toBeTruthy();
  });
});
