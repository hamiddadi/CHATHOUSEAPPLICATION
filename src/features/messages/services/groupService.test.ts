import { apiClient } from '../../../shared/services/api/apiClient';
import { groupService } from './groupService';

jest.mock('../../../shared/services/api/apiClient', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const post = apiClient.post as jest.Mock;
const rawMessage = {
  id: 'message-1',
  conversationId: 'group-1',
  senderId: 'viewer-1',
  content: 'hello',
  kind: 'TEXT',
  audioUrl: null,
  durationMs: null,
  createdAt: '2026-08-10T12:00:00.000Z',
};
const rawGroup = {
  id: 'group-1',
  title: 'Group',
  ownerId: 'viewer-1',
  members: [],
  lastMessage: null,
  unreadCount: 0,
  updatedAt: '2026-08-10T12:00:00.000Z',
};

describe('groupService idempotency headers', () => {
  beforeEach(() => post.mockReset());

  it('forwards the caller-owned key for every idempotent group mutation', async () => {
    post
      .mockResolvedValueOnce({ data: { data: rawMessage } })
      .mockResolvedValueOnce({
        data: {
          data: {
            ...rawMessage,
            id: 'voice-1',
            content: null,
            kind: 'VOICE',
            audioUrl: 'https://api.example.test/media/voice/signed',
            durationMs: 4_250,
          },
        },
      })
      .mockResolvedValueOnce({ data: { data: rawGroup } })
      .mockResolvedValueOnce({ data: { data: rawGroup } });

    await groupService.send('group-1', ' hello ', 'rn-group-text-123');
    await groupService.sendVoice(
      'group-1',
      'https://api.example.test/media/voice/signed',
      4_250,
      'rn-group-voice-123',
    );
    await groupService.create(['member-1'], ' Group ', 'rn-group-create-123');
    await groupService.addMembers('group-1', ['member-2'], 'rn-group-members-123');

    expect(post).toHaveBeenNthCalledWith(
      1,
      '/groups/group-1/messages',
      { content: 'hello' },
      { headers: { 'Idempotency-Key': 'rn-group-text-123' } },
    );
    expect(post).toHaveBeenNthCalledWith(
      2,
      '/groups/group-1/voice',
      { audioUrl: 'https://api.example.test/media/voice/signed', durationMs: 4_250 },
      { headers: { 'Idempotency-Key': 'rn-group-voice-123' } },
    );
    expect(post).toHaveBeenNthCalledWith(
      3,
      '/groups',
      { memberIds: ['member-1'], title: 'Group' },
      { headers: { 'Idempotency-Key': 'rn-group-create-123' } },
    );
    expect(post).toHaveBeenNthCalledWith(
      4,
      '/groups/group-1/members',
      { userIds: ['member-2'] },
      { headers: { 'Idempotency-Key': 'rn-group-members-123' } },
    );
  });
});
