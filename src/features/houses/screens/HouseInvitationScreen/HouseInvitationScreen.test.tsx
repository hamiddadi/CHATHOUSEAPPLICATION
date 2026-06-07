import React from 'react';
import { Alert } from 'react-native';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { useAcceptInvitation, useHouse } from '../../hooks/useHouses';
import type { House } from '../../../../shared/types/domain';
import { HouseInvitationScreen } from './HouseInvitationScreen';

jest.mock('../../hooks/useHouses', () => {
  const actual = jest.requireActual('../../hooks/useHouses');
  return { ...actual, useHouse: jest.fn(), useAcceptInvitation: jest.fn() };
});

const mockUseHouse = useHouse as jest.Mock;
const mockUseAcceptInvitation = useAcceptInvitation as jest.Mock;

const ROUTE_PARAMS = { houseId: 'h1', inviteToken: 'tok-abcdef12345' };

const house: House = {
  id: 'h1',
  name: 'Builders Guild',
  description: 'A house for makers.',
  category: 'tech',
  categoryEmoji: '🛠️',
  iconUrl: null,
  privacy: 'open',
  ownerId: 'u1',
  membersCount: 1234,
  liveRoomsCount: 2,
  isJoinedByMe: false,
  members: [],
  createdAt: '2024-01-01T00:00:00.000Z',
} as House;

const houseQuery = (over: Record<string, unknown> = {}) => ({
  data: undefined,
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
  isRefetching: false,
  isFetching: false,
  error: null,
  ...over,
});

const acceptMutation = (over: Record<string, unknown> = {}) => ({
  mutate: jest.fn(),
  mutateAsync: jest.fn().mockResolvedValue(undefined),
  isPending: false,
  isError: false,
  reset: jest.fn(),
  ...over,
});

describe('HouseInvitationScreen', () => {
  beforeEach(() => {
    mockUseHouse.mockReset();
    mockUseAcceptInvitation.mockReset();
    mockUseAcceptInvitation.mockReturnValue(acceptMutation());
  });

  it('renders the invitation header while loading', () => {
    mockUseHouse.mockReturnValue(houseQuery({ isLoading: true }));
    renderScreen(<HouseInvitationScreen />, { routeParams: ROUTE_PARAMS });

    expect(screen.getByText('Invitation')).toBeTruthy();
    expect(screen.getByLabelText('Loading invitation')).toBeTruthy();
  });

  it('shows the error empty state when the house fails to load', () => {
    mockUseHouse.mockReturnValue(houseQuery({ isError: true }));
    renderScreen(<HouseInvitationScreen />, { routeParams: ROUTE_PARAMS });

    expect(screen.getByText('Invitation unavailable')).toBeTruthy();
  });

  it('renders the loaded house with accept and decline actions', () => {
    mockUseHouse.mockReturnValue(houseQuery({ data: house }));
    renderScreen(<HouseInvitationScreen />, { routeParams: ROUTE_PARAMS });

    expect(screen.getByText('Builders Guild')).toBeTruthy();
    expect(screen.getByText('Accept invitation')).toBeTruthy();
    expect(screen.getByText('Decline')).toBeTruthy();
  });

  it('goes back when the decline button is pressed', () => {
    mockUseHouse.mockReturnValue(houseQuery({ data: house }));
    const { navigation } = renderScreen(<HouseInvitationScreen />, { routeParams: ROUTE_PARAMS });

    fireEvent.press(screen.getByText('Decline'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('accepts the invitation then replaces with the house detail', async () => {
    const mutateAsync = jest.fn().mockResolvedValue(undefined);
    mockUseHouse.mockReturnValue(houseQuery({ data: house }));
    mockUseAcceptInvitation.mockReturnValue(acceptMutation({ mutateAsync }));
    const { navigation } = renderScreen(<HouseInvitationScreen />, { routeParams: ROUTE_PARAMS });

    fireEvent.press(screen.getByText('Accept invitation'));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        houseId: 'h1',
        inviteToken: 'tok-abcdef12345',
      }),
    );
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('HouseDetail', { houseId: 'h1' }),
    );
  });

  it('surfaces an alert and does not navigate when accepting fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const mutateAsync = jest.fn().mockRejectedValue(new Error('nope'));
    mockUseHouse.mockReturnValue(houseQuery({ data: house }));
    mockUseAcceptInvitation.mockReturnValue(acceptMutation({ mutateAsync }));
    const { navigation } = renderScreen(<HouseInvitationScreen />, { routeParams: ROUTE_PARAMS });

    fireEvent.press(screen.getByText('Accept invitation'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
    expect(navigation.replace).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
