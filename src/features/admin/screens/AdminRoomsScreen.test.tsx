import React from 'react';
import { Alert } from 'react-native';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useAdminRooms, useForceEndRoom } from '../hooks/useAdmin';
import type { AdminRoom } from '../types/admin.types';
import { AdminRoomsScreen } from './AdminRoomsScreen';

jest.mock('../hooks/useAdmin', () => {
  const actual = jest.requireActual('../hooks/useAdmin');
  return { ...actual, useAdminRooms: jest.fn(), useForceEndRoom: jest.fn() };
});

const mockUseAdminRooms = useAdminRooms as unknown as jest.Mock;
const mockUseForceEndRoom = useForceEndRoom as unknown as jest.Mock;

type QueryOverrides = Partial<ReturnType<typeof queryState>>;

const queryState = (over: Record<string, unknown> = {}) => ({
  data: undefined as AdminRoom[] | undefined,
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
  isRefetching: false,
  isFetching: false,
  error: null,
  ...over,
});

const makeMutation = (over: Record<string, unknown> = {}) => ({
  mutate: jest.fn(),
  mutateAsync: jest.fn().mockResolvedValue(undefined),
  isPending: false,
  isError: false,
  reset: jest.fn(),
  variables: undefined,
  ...over,
});

const makeRoom = (over: Partial<AdminRoom> = {}): AdminRoom => ({
  id: 'r1',
  title: 'Morning Standup',
  isLive: true,
  isPrivate: false,
  participantCount: 5,
  hostId: 'h1',
  host: {
    id: 'h1',
    username: 'alice',
    displayName: 'Alice',
    avatarUrl: null,
  },
  createdAt: '2026-06-06T00:00:00.000Z',
  endedAt: null,
  _count: { participants: 5 },
  ...over,
});

describe('AdminRoomsScreen', () => {
  beforeEach(() => {
    mockUseAdminRooms.mockReset();
    mockUseForceEndRoom.mockReset();
    mockUseForceEndRoom.mockReturnValue(makeMutation());
  });

  const setRooms = (over: QueryOverrides) => mockUseAdminRooms.mockReturnValue(queryState(over));

  it('renders the header and force-end notice', () => {
    setRooms({ data: [] });
    renderScreen(<AdminRoomsScreen />);
    expect(screen.getByText(i18n.t('admin.rooms.liveRooms'))).toBeTruthy();
    expect(screen.getByText(i18n.t('admin.rooms.forceEndNotice'))).toBeTruthy();
  });

  it('shows the loader while rooms are loading', () => {
    setRooms({ isLoading: true });
    renderScreen(<AdminRoomsScreen />);
    expect(screen.getByLabelText(i18n.t('common.loading'))).toBeTruthy();
  });

  it('shows an error state when the query fails', () => {
    setRooms({ isError: true, data: undefined });
    renderScreen(<AdminRoomsScreen />);
    expect(screen.getByText(i18n.t('admin.rooms.errorLoadingRooms'))).toBeTruthy();
  });

  it('shows the empty state when there are no rooms', () => {
    setRooms({ data: [] });
    renderScreen(<AdminRoomsScreen />);
    expect(screen.getByText(i18n.t('admin.rooms.empty'))).toBeTruthy();
  });

  it('renders a room row with a labelled close-room action', async () => {
    const room = makeRoom();
    setRooms({ data: [room] });
    renderScreen(<AdminRoomsScreen />);
    expect(await screen.findByText(room.title)).toBeTruthy();
    expect(screen.getByLabelText(`${i18n.t('admin.rooms.closeRoom')} ${room.title}`)).toBeTruthy();
  });

  it('confirms via prompt and fires the force-end mutation', async () => {
    const mutation = makeMutation();
    mockUseForceEndRoom.mockReturnValue(mutation);
    const room = makeRoom();
    setRooms({ data: [room] });

    const promptSpy = jest
      .spyOn(Alert, 'prompt')
      .mockImplementation((_title, _message, buttons) => {
        const list = Array.isArray(buttons) ? buttons : [];
        const confirm = list.find(b => b.style === 'destructive');
        // onPress arg is a string|{login,password} union (prompt types); we use plain-text.
        confirm?.onPress?.('Spamming' as never);
      });

    try {
      renderScreen(<AdminRoomsScreen />);
      const button = await screen.findByLabelText(
        `${i18n.t('admin.rooms.closeRoom')} ${room.title}`,
      );
      fireEvent.press(button);

      await waitFor(() => expect(promptSpy).toHaveBeenCalled());
      expect(mutation.mutate).toHaveBeenCalledWith(
        { roomId: 'r1', reason: 'Spamming' },
        expect.objectContaining({ onError: expect.any(Function) }),
      );
    } finally {
      promptSpy.mockRestore();
    }
  });
});
