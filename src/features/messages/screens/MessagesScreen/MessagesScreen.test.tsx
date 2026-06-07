import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useConversations } from '../../hooks/useMessages';
import { useGroups } from '../../hooks/useGroups';
import type { Conversation } from '../../../../shared/types/domain';
import type { GroupConversation } from '../../services/groupService';
import { MessagesScreen } from './MessagesScreen';

// Realtime hooks are pure side-effects (socket subscriptions) — stub them so no
// async socket work runs during the test.
jest.mock('../../hooks/useChatSocket', () => ({ useChatSocket: jest.fn() }));
jest.mock('../../hooks/useGroupSocket', () => ({ useGroupSocket: jest.fn() }));

// Keep messageKeys/groupKeys real; only override the data hooks.
jest.mock('../../hooks/useMessages', () => {
  const actual = jest.requireActual('../../hooks/useMessages');
  return { ...actual, useConversations: jest.fn() };
});
jest.mock('../../hooks/useGroups', () => {
  const actual = jest.requireActual('../../hooks/useGroups');
  return { ...actual, useGroups: jest.fn() };
});

// Auth store: the screen selects `s.user?.id ?? null`. Support selector usage.
jest.mock('../../../auth/store/authStore', () => ({
  useAuthStore: jest.fn((selector?: (state: unknown) => unknown) => {
    const state = { user: { id: 'user-me' }, status: 'authenticated' };
    return selector ? selector(state) : state;
  }),
}));

const mockUseConversations = useConversations as jest.Mock;
const mockUseGroups = useGroups as jest.Mock;

const queryState = (over: Record<string, unknown> = {}) => ({
  data: undefined,
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: jest.fn(),
  error: null,
  ...over,
});

const buildConversation = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'c1',
  participants: [
    { id: 'user-me', username: 'me', displayName: 'Me', avatarUrl: null },
    { id: 'u1', username: 'alex', displayName: 'Alex Rivers', avatarUrl: null },
  ],
  lastMessage: {
    id: 'm1',
    conversationId: 'c1',
    authorId: 'u1',
    text: 'Hey there',
    kind: 'text',
    audioUrl: null,
    durationMs: null,
    sentAt: new Date().toISOString(),
    isMine: false,
  },
  unreadCount: 0,
  updatedAt: new Date().toISOString(),
  ...over,
});

const buildGroup = (over: Partial<GroupConversation> = {}): GroupConversation => ({
  id: 'g1',
  title: 'Launch crew',
  ownerId: 'user-me',
  members: [
    { id: 'user-me', username: 'me', displayName: 'Me', avatarUrl: null },
    { id: 'u2', username: 'sarahc', displayName: 'Sarah Chen', avatarUrl: null },
  ],
  lastMessage: null,
  unreadCount: 0,
  updatedAt: new Date().toISOString(),
  ...over,
});

describe('MessagesScreen', () => {
  beforeEach(() => {
    mockUseConversations.mockReset();
    mockUseGroups.mockReset();
    mockUseGroups.mockReturnValue(queryState({ data: [] }));
  });

  it('renders the title and new-chat action', () => {
    mockUseConversations.mockReturnValue(queryState({ data: [] }));
    renderScreen(<MessagesScreen />);
    expect(screen.getByText(i18n.t('messages.title'))).toBeTruthy();
    expect(screen.getByLabelText(i18n.t('messages.newChatA11y'))).toBeTruthy();
  });

  it('shows the loader while conversations are loading', () => {
    mockUseConversations.mockReturnValue(queryState({ isLoading: true }));
    renderScreen(<MessagesScreen />);
    expect(screen.getByLabelText(i18n.t('common.loading'))).toBeTruthy();
  });

  it('shows the error empty-state when the query fails', () => {
    mockUseConversations.mockReturnValue(queryState({ isError: true }));
    renderScreen(<MessagesScreen />);
    expect(screen.getByText(i18n.t('messages.couldNotLoad'))).toBeTruthy();
    expect(screen.getByText(i18n.t('messages.pullToRetry'))).toBeTruthy();
  });

  it('shows the empty-state when there are no conversations or groups', () => {
    mockUseConversations.mockReturnValue(queryState({ data: [] }));
    renderScreen(<MessagesScreen />);
    expect(screen.getByText(i18n.t('messages.empty'))).toBeTruthy();
    expect(screen.getByText(i18n.t('messages.startHint'))).toBeTruthy();
  });

  it('navigates to ChatDetail when a conversation row is pressed', async () => {
    mockUseConversations.mockReturnValue(queryState({ data: [buildConversation()] }));
    const { navigation } = renderScreen(<MessagesScreen />);
    fireEvent.press(await screen.findByLabelText('Open chat with Alex Rivers'));
    await waitFor(() =>
      expect(navigation.navigate).toHaveBeenCalledWith('ChatDetail', { conversationId: 'c1' }),
    );
  });

  it('navigates to NewMessage when the compose button is pressed', () => {
    mockUseConversations.mockReturnValue(queryState({ data: [] }));
    const { navigation } = renderScreen(<MessagesScreen />);
    fireEvent.press(screen.getByLabelText(i18n.t('messages.newChatA11y')));
    expect(navigation.navigate).toHaveBeenCalledWith('NewMessage');
  });

  it('renders a group row and opens GroupChat when pressed', async () => {
    mockUseConversations.mockReturnValue(queryState({ data: [] }));
    mockUseGroups.mockReturnValue(queryState({ data: [buildGroup()] }));
    const { navigation } = renderScreen(<MessagesScreen />);
    fireEvent.press(await screen.findByLabelText('Open group Launch crew'));
    await waitFor(() =>
      expect(navigation.navigate).toHaveBeenCalledWith('GroupChat', { conversationId: 'g1' }),
    );
  });
});
