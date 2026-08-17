import { apiClient } from '../../../shared/services/api/apiClient';
import { useAuthStore } from '../../auth/store/authStore';
import { messageService } from './messageService';

const rawUser = {
  id: 'peer-1',
  username: 'alice',
  displayName: 'Alice',
  avatarUrl: null,
};

const rawMessage = {
  id: 'message-1',
  senderId: 'peer-1',
  receiverId: 'viewer-1',
  content: 'hello',
  kind: 'TEXT' as const,
  audioUrl: null,
  audioDurationMs: null,
  isRead: false,
  createdAt: '2026-08-10T12:00:00.000Z',
  sender: rawUser,
};

describe('messageService pagination', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: {
        id: 'viewer-1',
        username: 'viewer',
        displayName: 'Viewer',
        phoneNumber: '+10000000000',
        avatarUrl: null,
        bio: null,
        interests: [],
        hasCompletedOnboarding: true,
        accountState: 'ACTIVE',
        deletedAt: null,
        permanentDeletionAt: null,
        createdAt: '2026-08-10T00:00:00.000Z',
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('requests a real conversation page and preserves its opaque next cursor', async () => {
    const get = jest.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        data: {
          data: [{ peer: rawUser, lastMessage: rawMessage, unreadCount: 7 }],
          nextCursor: 'v1.next-conversation',
          hasMore: true,
        },
      },
    });

    const page = await messageService.conversations('v1.current-conversation', 25);

    expect(get).toHaveBeenCalledWith('/chat/conversations', {
      params: { limit: 25, cursor: 'v1.current-conversation' },
    });
    expect(page.nextCursor).toBe('v1.next-conversation');
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: 'peer-1', unreadCount: 7 });
  });

  it('opts thread history into the composite-cursor envelope', async () => {
    const get = jest.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        data: {
          data: [rawMessage],
          nextCursor: 'v1.next-message',
          hasMore: true,
        },
      },
    });

    const page = await messageService.messages('peer-1', {
      before: 'v1.current-message',
      limit: 30,
    });

    expect(get).toHaveBeenCalledWith('/chat/peer-1', {
      params: { paginated: true, before: 'v1.current-message', limit: 30 },
    });
    expect(page).toMatchObject({
      nextCursor: 'v1.next-message',
      items: [{ id: 'message-1', conversationId: 'peer-1', text: 'hello' }],
    });
  });

  it('sends a text DM with the logical attempt idempotency key', async () => {
    const post = jest.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: rawMessage } });

    await messageService.send('peer-1', '  hello  ', 'rn-text-attempt-123');

    expect(post).toHaveBeenCalledWith(
      '/chat/peer-1',
      { content: 'hello' },
      { headers: { 'Idempotency-Key': 'rn-text-attempt-123' } },
    );
  });

  it('sends a voice DM with the logical attempt idempotency key', async () => {
    const voiceMessage = {
      ...rawMessage,
      content: null,
      kind: 'VOICE' as const,
      audioUrl: 'https://api.example.test/media/voice/signed',
      audioDurationMs: 4_250,
    };
    const post = jest.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: voiceMessage } });

    await messageService.sendVoice(
      'peer-1',
      voiceMessage.audioUrl,
      voiceMessage.audioDurationMs,
      'rn-voice-attempt-456',
    );

    expect(post).toHaveBeenCalledWith(
      '/chat/peer-1/voice',
      { audioUrl: voiceMessage.audioUrl, durationMs: 4_250 },
      { headers: { 'Idempotency-Key': 'rn-voice-attempt-456' } },
    );
  });
});
