import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import {
  useConversation,
  useConversationMessages,
  useSendMessage,
  useSendVoiceMessage,
  useMarkConversationRead,
} from '../../hooks/useMessages';
import { useTypingIndicator } from '../../hooks/useTypingIndicator';
import { useVoiceMessage } from '../../hooks/useVoiceMessage';
import { useAuthStore } from '../../../auth/store/authStore';
import type { Conversation, Message } from '../../../../shared/types/domain';
import { ChatDetailScreen } from './ChatDetailScreen';

// Keep messageKeys (and any other real exports) intact; override only the hooks
// so no real react-query/network work runs.
jest.mock('../../hooks/useMessages', () => {
  const actual = jest.requireActual('../../hooks/useMessages');
  return {
    ...actual,
    useConversation: jest.fn(),
    useConversationMessages: jest.fn(),
    useSendMessage: jest.fn(),
    useSendVoiceMessage: jest.fn(),
    useMarkConversationRead: jest.fn(),
  };
});

jest.mock('../../hooks/useTypingIndicator', () => ({
  useTypingIndicator: jest.fn(),
}));

// Mocking this hook also prevents its transitive expo-audio import (via
// useVoiceRecorder) from loading under node.
jest.mock('../../hooks/useVoiceMessage', () => ({
  useVoiceMessage: jest.fn(),
}));

jest.mock('../../../auth/store/authStore', () => ({
  useAuthStore: jest.fn(),
}));

const mockUseConversation = useConversation as jest.Mock;
const mockUseConversationMessages = useConversationMessages as jest.Mock;
const mockUseSendMessage = useSendMessage as jest.Mock;
const mockUseSendVoiceMessage = useSendVoiceMessage as jest.Mock;
const mockUseMarkConversationRead = useMarkConversationRead as jest.Mock;
const mockUseTypingIndicator = useTypingIndicator as jest.Mock;
const mockUseVoiceMessage = useVoiceMessage as jest.Mock;
const mockUseAuthStore = useAuthStore as unknown as jest.Mock;

const CONVERSATION_ID = 'peer-1';
const ME_ID = 'user-me';

const peer = {
  id: 'peer-1',
  username: 'alex',
  displayName: 'Alex Rivers',
  avatarUrl: null,
};

const conversation: Conversation = {
  id: CONVERSATION_ID,
  participants: [{ id: ME_ID, username: 'claude', displayName: 'Claude', avatarUrl: null }, peer],
  lastMessage: null,
  unreadCount: 0,
  updatedAt: '2026-06-06T10:00:00.000Z',
};

const message = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  conversationId: CONVERSATION_ID,
  authorId: peer.id,
  text: 'Hey there',
  kind: 'text',
  audioUrl: null,
  durationMs: null,
  sentAt: new Date().toISOString(),
  isMine: false,
  ...over,
});

const queryState = <T,>(over: Partial<Record<string, unknown>> = {}) => ({
  data: undefined as T | undefined,
  isLoading: false,
  isError: false,
  error: null,
  isFetching: false,
  isRefetching: false,
  refetch: jest.fn(),
  ...over,
});

const mutationState = (over: Partial<Record<string, unknown>> = {}) => ({
  mutate: jest.fn(),
  mutateAsync: jest.fn().mockResolvedValue(undefined),
  isPending: false,
  isError: false,
  reset: jest.fn(),
  ...over,
});

const voiceComposer = (over: Partial<Record<string, unknown>> = {}) => ({
  isActive: false,
  isRecording: false,
  isUploading: false,
  elapsedMs: 0,
  startRecording: jest.fn().mockResolvedValue(undefined),
  cancelRecording: jest.fn(),
  sendRecording: jest.fn().mockResolvedValue(undefined),
  ...over,
});

const setup = () =>
  renderScreen(<ChatDetailScreen />, {
    routeName: 'ChatDetail',
    routeParams: { conversationId: CONVERSATION_ID },
  });

describe('ChatDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseConversation.mockReturnValue(queryState({ data: conversation }));
    mockUseConversationMessages.mockReturnValue(queryState({ data: [message()] }));
    mockUseSendMessage.mockReturnValue(mutationState());
    mockUseSendVoiceMessage.mockReturnValue(mutationState());
    mockUseMarkConversationRead.mockReturnValue(mutationState());
    mockUseTypingIndicator.mockReturnValue({ isPeerTyping: false, notifyTyping: jest.fn() });
    mockUseVoiceMessage.mockReturnValue(voiceComposer());
    // Selector-aware store mock: return the slice the component selects.
    mockUseAuthStore.mockImplementation((selector?: (s: unknown) => unknown) => {
      const state = { user: { id: ME_ID } };
      return selector ? selector(state) : state;
    });
  });

  it('renders the loaded conversation header and input bar', () => {
    setup();
    expect(screen.getByText('Alex Rivers')).toBeTruthy();
    expect(screen.getByLabelText(i18n.t('chat.backA11y'))).toBeTruthy();
    // Empty draft -> the mic button is shown (not the send button).
    expect(screen.getByLabelText(i18n.t('chat.micA11y'))).toBeTruthy();
  });

  it('shows the loader while messages are loading', () => {
    mockUseConversationMessages.mockReturnValue(queryState({ data: undefined, isLoading: true }));
    setup();
    expect(screen.getByLabelText('Loading messages')).toBeTruthy();
  });

  it('shows the typing indicator when the peer is typing', () => {
    mockUseTypingIndicator.mockReturnValue({ isPeerTyping: true, notifyTyping: jest.fn() });
    setup();
    expect(screen.getByText(i18n.t('chat.typing'))).toBeTruthy();
  });

  it('navigates back when the back button is pressed', () => {
    const { navigation } = setup();
    fireEvent.press(screen.getByLabelText(i18n.t('chat.backA11y')));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('sends the typed message via the send mutation', async () => {
    const sendMutation = mutationState();
    mockUseSendMessage.mockReturnValue(sendMutation);
    setup();

    fireEvent.changeText(screen.getByPlaceholderText(i18n.t('chat.inputPlaceholder')), 'Hello!');
    // Typing a non-empty draft swaps the mic button for the send button.
    const sendButton = await screen.findByLabelText(i18n.t('chat.sendA11y'));
    fireEvent.press(sendButton);

    await waitFor(() => {
      expect(sendMutation.mutateAsync).toHaveBeenCalledWith({
        conversationId: CONVERSATION_ID,
        text: 'Hello!',
      });
    });
  });

  it('appends an emoji to the draft when the emoji button is pressed', async () => {
    setup();
    const input = screen.getByPlaceholderText(i18n.t('chat.inputPlaceholder'));
    fireEvent.press(screen.getByLabelText(i18n.t('chat.emojiA11y')));
    await waitFor(() => {
      expect(input.props.value).toContain('🙂');
    });
  });
});
