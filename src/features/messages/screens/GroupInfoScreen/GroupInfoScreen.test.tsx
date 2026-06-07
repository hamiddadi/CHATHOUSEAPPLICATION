import React from 'react';
import { Alert } from 'react-native';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import type { GroupConversation } from '../../services/groupService';
import {
  useGroup,
  useLeaveGroup,
  useRemoveGroupMember,
  useRenameGroup,
} from '../../hooks/useGroups';
import { useAuthStore } from '../../../auth/store/authStore';
import { GroupInfoScreen } from './GroupInfoScreen';

jest.mock('../../hooks/useGroups', () => {
  const actual = jest.requireActual('../../hooks/useGroups');
  return {
    ...actual,
    useGroup: jest.fn(),
    useRenameGroup: jest.fn(),
    useRemoveGroupMember: jest.fn(),
    useLeaveGroup: jest.fn(),
  };
});

jest.mock('../../../auth/store/authStore', () => ({
  useAuthStore: jest.fn(),
}));

const mockUseGroup = useGroup as jest.Mock;
const mockUseRenameGroup = useRenameGroup as jest.Mock;
const mockUseRemoveGroupMember = useRemoveGroupMember as jest.Mock;
const mockUseLeaveGroup = useLeaveGroup as jest.Mock;
const mockUseAuthStore = useAuthStore as unknown as jest.Mock;

const MY_ID = 'me-1';
const CONVERSATION_ID = 'conv-1';

const group: GroupConversation = {
  id: CONVERSATION_ID,
  title: 'Weekend crew',
  ownerId: MY_ID,
  members: [
    { id: MY_ID, username: 'me', displayName: 'Me Myself', avatarUrl: null },
    { id: 'other-1', username: 'sam', displayName: 'Sam Stone', avatarUrl: null },
  ],
  lastMessage: null,
  unreadCount: 0,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const queryState = (over: Record<string, unknown> = {}) => ({
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  refetch: jest.fn(),
  isRefetching: false,
  isFetching: false,
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

const renderGroupInfo = () =>
  renderScreen(<GroupInfoScreen />, {
    routeName: 'GroupInfo',
    routeParams: { conversationId: CONVERSATION_ID },
  });

describe('GroupInfoScreen', () => {
  beforeEach(() => {
    mockUseGroup.mockReset();
    mockUseRenameGroup.mockReset();
    mockUseRemoveGroupMember.mockReset();
    mockUseLeaveGroup.mockReset();
    mockUseAuthStore.mockReset();

    mockUseAuthStore.mockImplementation((selector?: (s: unknown) => unknown) => {
      const state = { user: { id: MY_ID } };
      return selector ? selector(state) : state;
    });
    mockUseRenameGroup.mockReturnValue(mutationState());
    mockUseRemoveGroupMember.mockReturnValue(mutationState());
    mockUseLeaveGroup.mockReturnValue(mutationState());
  });

  it('shows the loader while the group is loading', () => {
    mockUseGroup.mockReturnValue(queryState({ isLoading: true }));
    renderGroupInfo();
    expect(screen.getByLabelText(i18n.t('common.loading'))).toBeTruthy();
  });

  it('renders the group info header and members once loaded', () => {
    mockUseGroup.mockReturnValue(queryState({ data: group }));
    renderGroupInfo();

    expect(screen.getByText(i18n.t('messages.groupInfo', 'Group info'))).toBeTruthy();
    expect(screen.getByText('Sam Stone')).toBeTruthy();
    expect(screen.getByText(i18n.t('messages.addPeople', 'Add people'))).toBeTruthy();
    expect(screen.getByText(i18n.t('messages.leaveGroup', 'Leave group'))).toBeTruthy();
  });

  it('navigates back when the back button is pressed', () => {
    mockUseGroup.mockReturnValue(queryState({ data: group }));
    const { navigation } = renderGroupInfo();

    fireEvent.press(screen.getAllByRole('button')[0]);
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('navigates to AddGroupMembers when Add people is pressed', () => {
    mockUseGroup.mockReturnValue(queryState({ data: group }));
    const { navigation } = renderGroupInfo();

    fireEvent.press(screen.getByText(i18n.t('messages.addPeople', 'Add people')));
    expect(navigation.navigate).toHaveBeenCalledWith('AddGroupMembers', {
      conversationId: CONVERSATION_ID,
    });
  });

  it('renames the group after editing the title and pressing save', async () => {
    const renameMutation = mutationState();
    mockUseRenameGroup.mockReturnValue(renameMutation);
    mockUseGroup.mockReturnValue(queryState({ data: group }));
    renderGroupInfo();

    const input = screen.getByPlaceholderText(
      i18n.t('messages.groupNamePlaceholder', 'Name this group'),
    );
    fireEvent.changeText(input, 'Renamed crew');

    fireEvent.press(await screen.findByLabelText(i18n.t('common.save', 'Save')));

    await waitFor(() => {
      expect(renameMutation.mutate).toHaveBeenCalledWith({
        conversationId: CONVERSATION_ID,
        title: 'Renamed crew',
      });
    });
  });

  it('confirms removal via an alert and fires the remove mutation', () => {
    const removeMutation = mutationState();
    mockUseRemoveGroupMember.mockReturnValue(removeMutation);
    mockUseGroup.mockReturnValue(queryState({ data: group }));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    renderGroupInfo();

    fireEvent.press(screen.getByLabelText('Remove Sam Stone'));
    expect(alertSpy).toHaveBeenCalled();

    const buttons = (alertSpy.mock.calls[0]?.[2] ?? []) as { text: string; onPress?: () => void }[];
    const remove = buttons.find(b => b.text === i18n.t('messages.remove', 'Remove'));
    remove?.onPress?.();

    expect(removeMutation.mutate).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      userId: 'other-1',
    });

    alertSpy.mockRestore();
  });
});
