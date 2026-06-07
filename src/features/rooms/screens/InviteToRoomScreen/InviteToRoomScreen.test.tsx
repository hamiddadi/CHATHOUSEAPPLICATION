import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useInviteToRoom } from '../../hooks/useRooms';
import { searchService } from '../../../search/services/searchService';
import type { SearchUserHit } from '../../../search/services/searchService';
import { InviteToRoomScreen } from './InviteToRoomScreen';

jest.mock('../../hooks/useRooms', () => {
  const actual = jest.requireActual('../../hooks/useRooms');
  return { ...actual, useInviteToRoom: jest.fn() };
});

jest.mock('../../../search/services/searchService', () => ({
  searchService: { users: jest.fn() },
}));

const mockUseInviteToRoom = useInviteToRoom as unknown as jest.Mock;
const mockUsersSearch = searchService.users as jest.Mock;

const mutationState = (over: Partial<ReturnType<typeof baseMutation>> = {}) => ({
  ...baseMutation(),
  ...over,
});

function baseMutation() {
  return {
    mutate: jest.fn(),
    mutateAsync: jest.fn().mockResolvedValue({ invitedCount: 0 }),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    reset: jest.fn(),
  };
}

const makeHit = (over: Partial<SearchUserHit> = {}): SearchUserHit =>
  ({
    id: 'u1',
    username: 'jdoe',
    displayName: 'Jane Doe',
    avatarUrl: null,
    bio: null,
    isOnline: true,
    ...over,
  }) as SearchUserHit;

const ROUTE_PARAMS = { roomId: 'r1' };

describe('InviteToRoomScreen', () => {
  beforeEach(() => {
    mockUseInviteToRoom.mockReset();
    mockUseInviteToRoom.mockReturnValue(mutationState());
    mockUsersSearch.mockReset();
    mockUsersSearch.mockResolvedValue([]);
  });

  it('renders the title, idle send button and close control', () => {
    renderScreen(<InviteToRoomScreen />, { routeParams: ROUTE_PARAMS, routeName: 'InviteToRoom' });

    expect(screen.getByText(i18n.t('rooms.invite.title'))).toBeTruthy();
    expect(
      screen.getByText(i18n.t('rooms.invite.btnIdle', 'Sélectionnez des invités')),
    ).toBeTruthy();
    expect(screen.getByLabelText(i18n.t('rooms.invite.closeA11y', 'Fermer'))).toBeTruthy();
  });

  it('shows the idle empty state before any search query', () => {
    renderScreen(<InviteToRoomScreen />, { routeParams: ROUTE_PARAMS, routeName: 'InviteToRoom' });

    expect(screen.getByText(i18n.t('rooms.invite.emptyTitle', "Cherchez quelqu'un"))).toBeTruthy();
  });

  it('closes the screen when the close control is pressed', () => {
    const { navigation } = renderScreen(<InviteToRoomScreen />, {
      routeParams: ROUTE_PARAMS,
      routeName: 'InviteToRoom',
    });

    fireEvent.press(screen.getByLabelText(i18n.t('rooms.invite.closeA11y', 'Fermer')));

    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('searches users when typing and renders the results', async () => {
    mockUsersSearch.mockResolvedValue([makeHit()]);
    renderScreen(<InviteToRoomScreen />, { routeParams: ROUTE_PARAMS, routeName: 'InviteToRoom' });

    fireEvent.changeText(
      screen.getByPlaceholderText(
        i18n.t('rooms.invite.searchPlaceholder', 'Rechercher des utilisateurs'),
      ),
      'jane',
    );

    expect(await screen.findByText('Jane Doe')).toBeTruthy();
    await waitFor(() => expect(mockUsersSearch).toHaveBeenCalledWith('jane', 20));
  });

  it('shows the no-results empty state when the search returns nothing', async () => {
    mockUsersSearch.mockResolvedValue([]);
    renderScreen(<InviteToRoomScreen />, { routeParams: ROUTE_PARAMS, routeName: 'InviteToRoom' });

    fireEvent.changeText(
      screen.getByPlaceholderText(
        i18n.t('rooms.invite.searchPlaceholder', 'Rechercher des utilisateurs'),
      ),
      'zzzz',
    );

    expect(
      await screen.findByText(i18n.t('rooms.invite.noResultsTitle', 'Aucun résultat')),
    ).toBeTruthy();
  });

  it('invites the selected candidate when Send is pressed', async () => {
    const mutate = jest.fn();
    mockUseInviteToRoom.mockReturnValue(mutationState({ mutate }));
    mockUsersSearch.mockResolvedValue([makeHit()]);

    renderScreen(<InviteToRoomScreen />, { routeParams: ROUTE_PARAMS, routeName: 'InviteToRoom' });

    fireEvent.changeText(
      screen.getByPlaceholderText(
        i18n.t('rooms.invite.searchPlaceholder', 'Rechercher des utilisateurs'),
      ),
      'jane',
    );

    fireEvent.press(await screen.findByRole('checkbox'));

    fireEvent.press(
      await screen.findByText(
        i18n.t('rooms.invite.btnActive', 'Envoyer ({{count}})', { count: 1 }),
      ),
    );

    expect(mutate).toHaveBeenCalledWith(
      { roomId: 'r1', userIds: ['u1'] },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });
});
