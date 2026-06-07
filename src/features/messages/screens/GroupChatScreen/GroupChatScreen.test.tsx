import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import {
  useGroup,
  useGroupMessages,
  useSendGroupMessage,
  useSendGroupVoice,
  useMarkGroupRead,
} from '../../hooks/useGroups';
import { useVoiceMessage } from '../../hooks/useVoiceMessage';
import { useAuthStore } from '../../../auth/store/authStore';
import type { GroupConversation, GroupMessage } from '../../services/groupService';
import { GroupChatScreen } from './GroupChatScreen';

// expo-audio is a native module pulled in transitively by VoiceMessageBubble; it
// calls requireNativeModule at import time, so stub it with a data-only factory.
jest.mock('expo-audio', () => ({
  useAudioPlayer: () => ({ play: jest.fn(), pause: jest.fn(), seekTo: jest.fn() }),
  useAudioPlayerStatus: () => ({
    playing: false,
    currentTime: 0,
    duration: 0,
    didJustFinish: false,
  }),
  setAudioModeAsync: jest.fn(),
}));

jest.mock('../../hooks/useGroups', () => {
  const actual = jest.requireActual('../../hooks/useGroups');
  return {
    ...actual,
    useGroup: jest.fn(),
    useGroupMessages: jest.fn(),
    useSendGroupMessage: jest.fn(),
    useSendGroupVoice: jest.fn(),
    useMarkGroupRead: jest.fn(),
  };
});

jest.mock('../../hooks/useVoiceMessage', () => ({ useVoiceMessage: jest.fn() }));

jest.mock('../../../auth/store/authStore', () => ({ useAuthStore: jest.fn() }));

jest.mock('../../../../shared/hooks/useApiErrorToast', () => ({
  useApiErrorToast: () => jest.fn(),
}));

const mockUseGroup = useGroup as jest.Mock;
const mockUseGroupMessages = useGroupMessages as jest.Mock;
const mockUseSendGroupMessage = useSendGroupMessage as jest.Mock;
const mockUseSendGroupVoice = useSendGroupVoice as jest.Mock;
const mockUseMarkGroupRead = useMarkGroupRead as jest.Mock;
const mockUseVoiceMessage = useVoiceMessage as jest.Mock;
const mockUseAuthStore = useAuthStore as unknown as jest.Mock;

const CONVERSATION_ID = 'g1';
const MY_ID = 'me';

const group: GroupConversation = {
  id: CONVERSATION_ID,
  title: 'Weekend crew',
  ownerId: MY_ID,
  members: [
    { id: MY_ID, username: 'me', displayName: 'Me', avatarUrl: null },
    { id: 'u2', username: 'ada', displayName: 'Ada', avatarUrl: null },
  ],
  lastMessage: null,
  unreadCount: 0,
  updatedAt: '2026-06-06T00:00:00.000Z',
};

const textMessage: GroupMessage = {
  id: 'm1',
  conversationId: CONVERSATION_ID,
  senderId: 'u2',
  content: 'Hello team',
  kind: 'text',
  audioUrl: null,
  durationMs: null,
  createdAt: '2026-06-06T00:01:00.000Z',
  sender: { id: 'u2', username: 'ada', displayName: 'Ada', avatarUrl: null },
};

const queryState = <T,>(over: Partial<Record<string, unknown>> = {}) => ({
  data: undefined as T | undefined,
  isLoading: false,
  isError: false,
  isFetching: false,
  isRefetching: false,
  error: null,
  refetch: jest.fn(),
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

const voiceState = (over: Record<string, unknown> = {}) => ({
  isActive: false,
  isRecording: false,
  isUploading: false,
  elapsedMs: 0,
  startRecording: jest.fn().mockResolvedValue(undefined),
  cancelRecording: jest.fn(),
  sendRecording: jest.fn().mockResolvedValue(undefined),
  ...over,
});

const renderGroupChat = () =>
  renderScreen(<GroupChatScreen />, {
    routeName: 'GroupChat',
    routeParams: { conversationId: CONVERSATION_ID },
  });

describe('GroupChatScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuthStore.mockImplementation((selector: (s: { user: { id: string } }) => unknown) =>
      selector({ user: { id: MY_ID } }),
    );
    mockUseGroup.mockReturnValue(queryState<GroupConversation>({ data: group }));
    mockUseGroupMessages.mockReturnValue(queryState<GroupMessage[]>({ data: [textMessage] }));
    mockUseSendGroupMessage.mockReturnValue(mutationState());
    mockUseSendGroupVoice.mockReturnValue(mutationState());
    mockUseMarkGroupRead.mockReturnValue(mutationState());
    mockUseVoiceMessage.mockReturnValue(voiceState());
  });

  it('renders the group title and member count', () => {
    renderGroupChat();
    expect(screen.getByText('Weekend crew')).toBeTruthy();
    expect(
      screen.getByText(i18n.t('messages.memberCount', { count: 2, defaultValue: '2 members' })),
    ).toBeTruthy();
  });

  it('shows a loader while messages are loading', () => {
    mockUseGroupMessages.mockReturnValue(queryState<GroupMessage[]>({ isLoading: true }));
    renderGroupChat();
    expect(screen.getByLabelText(i18n.t('common.loading'))).toBeTruthy();
  });

  it('renders message content for the loaded thread', () => {
    renderGroupChat();
    expect(screen.getByText('Hello team')).toBeTruthy();
  });

  it('navigates to GroupInfo when the header is pressed', () => {
    const { navigation } = renderGroupChat();
    fireEvent.press(screen.getAllByLabelText(i18n.t('messages.groupInfo', 'Group info'))[0]);
    expect(navigation.navigate).toHaveBeenCalledWith('GroupInfo', {
      conversationId: CONVERSATION_ID,
    });
  });

  it('sends a trimmed message when text is entered and Send is pressed', async () => {
    const send = mutationState();
    mockUseSendGroupMessage.mockReturnValue(send);
    renderGroupChat();

    fireEvent.changeText(
      screen.getByPlaceholderText(i18n.t('messages.messagePlaceholder', 'Message')),
      '  Hi all  ',
    );
    fireEvent.press(await screen.findByLabelText(i18n.t('common.send', 'Send')));

    await waitFor(() => {
      expect(send.mutate).toHaveBeenCalledWith(
        { conversationId: CONVERSATION_ID, text: 'Hi all' },
        expect.objectContaining({ onError: expect.any(Function) }),
      );
    });
  });

  it('starts a voice recording when the mic button is pressed', () => {
    const voice = voiceState();
    mockUseVoiceMessage.mockReturnValue(voice);
    renderGroupChat();

    fireEvent.press(screen.getByLabelText(i18n.t('voice.recordA11y')));
    expect(voice.startRecording).toHaveBeenCalledTimes(1);
  });
});
