import React from 'react';
import { Alert } from 'react-native';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { useHouse, useHouseRooms, useJoinHouse, useSetMemberRole } from '../../hooks/useHouses';
import { useAuthStore } from '../../../auth/store/authStore';
import type { House, HouseMember } from '../../../../shared/types/domain';
import type { HouseRoom } from '../../services/houseService';
import { HouseDetailScreen } from './HouseDetailScreen';

jest.mock('../../hooks/useHouses', () => ({
  useHouse: jest.fn(),
  useHouseRooms: jest.fn(),
  useJoinHouse: jest.fn(),
  useSetMemberRole: jest.fn(),
}));

jest.mock('../../../auth/store/authStore', () => ({
  useAuthStore: jest.fn(),
}));

const mockUseHouse = useHouse as jest.Mock;
const mockUseHouseRooms = useHouseRooms as jest.Mock;
const mockUseJoinHouse = useJoinHouse as jest.Mock;
const mockUseSetMemberRole = useSetMemberRole as jest.Mock;
const mockUseAuthStore = useAuthStore as unknown as jest.Mock;

const HOUSE_ID = 'house-1';
const VIEWER_ID = 'viewer-1';

const member = (over: Partial<HouseMember> = {}): HouseMember => ({
  id: 'm1',
  username: 'jane',
  displayName: 'Jane Doe',
  avatarUrl: null,
  role: 'member',
  joinedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const baseHouse = (over: Partial<House> = {}): House => ({
  id: HOUSE_ID,
  name: 'Design Guild',
  description: 'A house for designers.',
  category: 'design',
  categoryEmoji: '🎨',
  iconUrl: null,
  privacy: 'open',
  ownerId: 'owner-1',
  membersCount: 1234,
  liveRoomsCount: 2,
  isJoinedByMe: false,
  members: [member()],
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const queryState = <T,>(over: Partial<{ data: T; isLoading: boolean; isError: boolean }> = {}) => ({
  data: undefined as T | undefined,
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
  ...over,
});

const setViewer = (id: string | null) => {
  const state = { user: id ? { id } : null };
  mockUseAuthStore.mockImplementation((selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state,
  );
};

describe('HouseDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseHouseRooms.mockReturnValue(queryState<HouseRoom[]>({ data: [] }));
    mockUseJoinHouse.mockReturnValue(mutationState());
    mockUseSetMemberRole.mockReturnValue(mutationState());
    setViewer(VIEWER_ID);
  });

  const renderWithParams = () =>
    renderScreen(<HouseDetailScreen />, {
      routeName: 'HouseDetail',
      routeParams: { houseId: HOUSE_ID },
    });

  it('shows a loader while the house is loading', () => {
    mockUseHouse.mockReturnValue(queryState<House>({ isLoading: true }));
    renderWithParams();
    expect(screen.getByLabelText('Loading house')).toBeTruthy();
  });

  it('shows the unavailable empty state on error', () => {
    mockUseHouse.mockReturnValue(queryState<House>({ isError: true }));
    renderWithParams();
    expect(screen.getByText('House unavailable')).toBeTruthy();
  });

  it('renders the house header when loaded', () => {
    mockUseHouse.mockReturnValue(queryState<House>({ data: baseHouse() }));
    renderWithParams();
    expect(screen.getByText('Design Guild')).toBeTruthy();
    expect(screen.getByText('A house for designers.')).toBeTruthy();
    // Count is rendered via Number#toLocaleString(); compute it the same way so
    // the assertion is independent of the JS engine's ICU grouping behaviour.
    expect(screen.getByText((1234).toLocaleString())).toBeTruthy();
    expect(screen.getByText('Jane Doe')).toBeTruthy();
  });

  it('joins the house when the join button is pressed', () => {
    const mutate = jest.fn();
    mockUseJoinHouse.mockReturnValue(mutationState({ mutate }));
    mockUseHouse.mockReturnValue(queryState<House>({ data: baseHouse({ isJoinedByMe: false }) }));
    renderWithParams();
    fireEvent.press(screen.getByText('Rejoindre'));
    expect(mutate).toHaveBeenCalledWith(
      HOUSE_ID,
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('navigates to invite members for a joined house', () => {
    mockUseHouse.mockReturnValue(queryState<House>({ data: baseHouse({ isJoinedByMe: true }) }));
    const { navigation } = renderWithParams();
    fireEvent.press(screen.getByText('Invite members'));
    expect(navigation.navigate).toHaveBeenCalledWith('InviteMember', { houseId: HOUSE_ID });
  });

  it('opens a room from the live rooms section', async () => {
    const liveRoom: HouseRoom = {
      id: 'room-9',
      title: 'Friday critique',
      isLive: true,
      scheduledFor: null,
      participantCount: 12,
    };
    mockUseHouseRooms.mockImplementation((_id: string, filter: 'live' | 'upcoming') =>
      filter === 'live'
        ? queryState<HouseRoom[]>({ data: [liveRoom] })
        : queryState<HouseRoom[]>({ data: [] }),
    );
    mockUseHouse.mockReturnValue(queryState<House>({ data: baseHouse({ isJoinedByMe: true }) }));
    const { navigation } = renderWithParams();
    fireEvent.press(await screen.findByLabelText('Open room Friday critique'));
    expect(navigation.navigate).toHaveBeenCalledWith('Room', { roomId: 'room-9' });
  });

  it('lets an admin viewer manage a manageable member', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const admin = member({ id: VIEWER_ID, displayName: 'Admin Viewer', role: 'admin' });
    const target = member({ id: 'm2', displayName: 'Bob Builder', role: 'member' });
    mockUseHouse.mockReturnValue(
      queryState<House>({
        data: baseHouse({ isJoinedByMe: true, ownerId: 'owner-1', members: [admin, target] }),
      }),
    );
    renderWithParams();
    fireEvent.press(screen.getByLabelText('Manage role for Bob Builder'));
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Bob Builder', expect.any(String), expect.any(Array)),
    );
    alertSpy.mockRestore();
  });
});
