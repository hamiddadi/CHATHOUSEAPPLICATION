import React from 'react';
import { renderScreen, screen, fireEvent, waitFor, act } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useAddGroupMembers, useGroup } from '../../hooks/useGroups';
import { searchService, type SearchUserHit } from '../../../search/services/searchService';
import { AddGroupMembersScreen } from './AddGroupMembersScreen';

jest.mock('../../hooks/useGroups', () => {
  const actual = jest.requireActual('../../hooks/useGroups');
  return { ...actual, useGroup: jest.fn(), useAddGroupMembers: jest.fn() };
});

jest.mock('../../../search/services/searchService', () => ({
  searchService: { users: jest.fn() },
}));

const mockUseGroup = useGroup as unknown as jest.Mock;
const mockUseAddGroupMembers = useAddGroupMembers as unknown as jest.Mock;
const mockSearchUsers = searchService.users as jest.Mock;

const ROUTE_PARAMS = { conversationId: 'conv-1' };

const queryState = (over: Record<string, unknown> = {}) => ({
  data: undefined,
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

const makeHit = (over: Partial<SearchUserHit> = {}): SearchUserHit => ({
  id: 'u1',
  username: 'ada',
  displayName: 'Ada Lovelace',
  avatarUrl: null,
  bio: null,
  isOnline: false,
  ...over,
});

describe('AddGroupMembersScreen', () => {
  beforeEach(() => {
    mockUseGroup.mockReset();
    mockUseAddGroupMembers.mockReset();
    mockSearchUsers.mockReset();
    mockUseGroup.mockReturnValue(queryState());
    mockUseAddGroupMembers.mockReturnValue(mutationState());
    mockSearchUsers.mockResolvedValue([]);
  });

  it('renders the header and the empty search hint', () => {
    renderScreen(<AddGroupMembersScreen />, { routeParams: ROUTE_PARAMS });
    // Title appears as both the header and the action button label.
    expect(screen.getAllByText(i18n.t('messages.addPeople', 'Add people')).length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getByText(
        i18n.t('messages.searchPeopleHint', 'Search for people to add to this group.'),
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText(i18n.t('common.close', 'Close'))).toBeTruthy();
  });

  it('goes back when the close button is pressed', () => {
    const { navigation } = renderScreen(<AddGroupMembersScreen />, { routeParams: ROUTE_PARAMS });
    fireEvent.press(screen.getByLabelText(i18n.t('common.close', 'Close')));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('searches after typing (debounced) and shows the matching user', async () => {
    jest.useFakeTimers();
    mockSearchUsers.mockResolvedValue([makeHit()]);
    try {
      renderScreen(<AddGroupMembersScreen />, { routeParams: ROUTE_PARAMS });
      fireEvent.changeText(
        screen.getByPlaceholderText(i18n.t('messages.searchPeople', 'Search people')),
        'ada',
      );
      act(() => {
        jest.advanceTimersByTime(300);
      });
      await waitFor(() => expect(mockSearchUsers).toHaveBeenCalledWith('ada', 20));
    } finally {
      act(() => {
        jest.runOnlyPendingTimers();
      });
      jest.useRealTimers();
    }
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
  });

  it('shows the "no results" empty state when the search returns nothing', async () => {
    jest.useFakeTimers();
    mockSearchUsers.mockResolvedValue([]);
    try {
      renderScreen(<AddGroupMembersScreen />, { routeParams: ROUTE_PARAMS });
      fireEvent.changeText(
        screen.getByPlaceholderText(i18n.t('messages.searchPeople', 'Search people')),
        'zzz',
      );
      act(() => {
        jest.advanceTimersByTime(300);
      });
      await waitFor(() => expect(mockSearchUsers).toHaveBeenCalledWith('zzz', 20));
    } finally {
      act(() => {
        jest.runOnlyPendingTimers();
      });
      jest.useRealTimers();
    }
    expect(await screen.findByText(i18n.t('messages.noResults', 'No one found'))).toBeTruthy();
  });

  it('selecting a result reveals the Add button and calls the mutation with selected ids', async () => {
    jest.useFakeTimers();
    mockSearchUsers.mockResolvedValue([makeHit()]);
    const mutate = jest.fn();
    mockUseAddGroupMembers.mockReturnValue(mutationState({ mutate }));
    try {
      renderScreen(<AddGroupMembersScreen />, { routeParams: ROUTE_PARAMS });
      fireEvent.changeText(
        screen.getByPlaceholderText(i18n.t('messages.searchPeople', 'Search people')),
        'ada',
      );
      act(() => {
        jest.advanceTimersByTime(300);
      });
      await waitFor(() => expect(mockSearchUsers).toHaveBeenCalled());
    } finally {
      act(() => {
        jest.runOnlyPendingTimers();
      });
      jest.useRealTimers();
    }

    fireEvent.press(await screen.findByText('Ada Lovelace'));

    const addButton = await screen.findByText(
      i18n.t('messages.addN', { count: 1, defaultValue: 'Add 1' }),
    );
    fireEvent.press(addButton);

    expect(mutate).toHaveBeenCalledWith(
      { conversationId: 'conv-1', userIds: ['u1'] },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('goes back on a successful add', async () => {
    jest.useFakeTimers();
    mockSearchUsers.mockResolvedValue([makeHit()]);
    const mutate = jest.fn((_vars, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.());
    mockUseAddGroupMembers.mockReturnValue(mutationState({ mutate }));
    let navigation: ReturnType<typeof renderScreen>['navigation'];
    try {
      const rendered = renderScreen(<AddGroupMembersScreen />, { routeParams: ROUTE_PARAMS });
      navigation = rendered.navigation;
      fireEvent.changeText(
        screen.getByPlaceholderText(i18n.t('messages.searchPeople', 'Search people')),
        'ada',
      );
      act(() => {
        jest.advanceTimersByTime(300);
      });
      await waitFor(() => expect(mockSearchUsers).toHaveBeenCalled());
    } finally {
      act(() => {
        jest.runOnlyPendingTimers();
      });
      jest.useRealTimers();
    }

    fireEvent.press(await screen.findByText('Ada Lovelace'));
    fireEvent.press(
      await screen.findByText(i18n.t('messages.addN', { count: 1, defaultValue: 'Add 1' })),
    );

    expect(mutate).toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
