import { MessageKind } from '@prisma/client';
import { decodeChatCursor, encodeChatCursor } from '../src/modules/chat/chat.cursor';

const mockQueryRaw = jest.fn();

jest.mock('../src/config/database', () => ({
  prisma: { $queryRaw: (...args: unknown[]) => mockQueryRaw(...args) },
}));
jest.mock('../src/config/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));
jest.mock('../src/modules/notifications/notifications.service', () => ({
  notificationsService: {},
}));
jest.mock('../src/socket/realtime', () => ({ emitChatMessage: jest.fn() }));
jest.mock('../src/modules/media/media.service', () => ({ mediaService: {} }));
jest.mock('../src/utils/backgroundTasks', () => ({ scheduleBackgroundTask: jest.fn() }));
jest.mock('../src/modules/chat/chat.policy', () => ({ assertCanDirectMessage: jest.fn() }));

// Loaded after the database mock is declared so no real Prisma client is used.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chatService } =
  require('../src/modules/chat/chat.service') as typeof import('../src/modules/chat/chat.service');

const createdAt = new Date('2026-08-09T12:34:56.789Z');

const row = (overrides: Record<string, unknown> = {}) => ({
  peerId: 'peer-1',
  peerUsername: 'alice',
  peerDisplayName: 'Alice',
  peerAvatarUrl: 'https://example.test/alice.jpg',
  messageId: 'message-1',
  messageContent: 'hello',
  messageKind: MessageKind.TEXT,
  messageAudioUrl: null,
  messageAudioDurationMs: null,
  messageSenderId: 'peer-1',
  messageRoomId: null,
  messageReceiverId: 'viewer',
  messageIsRead: false,
  messageCreatedAt: createdAt,
  senderUsername: 'alice',
  senderDisplayName: 'Alice',
  senderAvatarUrl: 'https://example.test/alice.jpg',
  unreadCount: 503n,
  ...overrides,
});

describe('chat conversation cursor', () => {
  it('round-trips equal-timestamp boundaries with the last-message id', () => {
    const cursor = encodeChatCursor(createdAt, 'message-1');

    expect(cursor).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    expect(decodeChatCursor(cursor)).toEqual({ createdAt, messageId: 'message-1' });
  });

  it('accepts legacy timestamp-only cursors', () => {
    expect(decodeChatCursor(createdAt.toISOString())).toEqual({
      createdAt,
      messageId: null,
    });
  });

  it.each([
    '',
    'not-a-cursor',
    'v1.',
    'v1.***',
    '2026-02-30T12:00:00.000Z',
    `v1.${Buffer.from(JSON.stringify([createdAt.toISOString(), ''])).toString('base64url')}`,
  ])('rejects malformed cursor %p', cursor => {
    expect(decodeChatCursor(cursor)).toBeNull();
  });
});

describe('chatService.listConversations', () => {
  beforeEach(() => {
    mockQueryRaw.mockReset();
  });

  it('maps a bounded PostgreSQL page with exact unread counts and sender relation', async () => {
    mockQueryRaw.mockResolvedValue([
      row(),
      row({
        peerId: 'peer-2',
        peerUsername: 'bob',
        peerDisplayName: null,
        peerAvatarUrl: null,
        messageId: 'message-2',
        messageSenderId: 'viewer',
        messageReceiverId: 'peer-2',
        messageCreatedAt: new Date('2026-08-08T12:00:00.000Z'),
        senderUsername: 'viewer-name',
        senderDisplayName: 'Viewer',
        senderAvatarUrl: null,
        unreadCount: 0n,
      }),
    ]);

    const result = await chatService.listConversations('viewer', 1);

    expect(result.data).toEqual([
      {
        peer: {
          id: 'peer-1',
          username: 'alice',
          displayName: 'Alice',
          avatarUrl: 'https://example.test/alice.jpg',
        },
        lastMessage: {
          id: 'message-1',
          content: 'hello',
          kind: MessageKind.TEXT,
          audioUrl: null,
          audioDurationMs: null,
          senderId: 'peer-1',
          roomId: null,
          receiverId: 'viewer',
          isRead: false,
          createdAt,
          sender: {
            id: 'peer-1',
            username: 'alice',
            displayName: 'Alice',
            avatarUrl: 'https://example.test/alice.jpg',
          },
        },
        unreadCount: 503,
      },
    ]);
    expect(result.hasMore).toBe(true);
    expect(decodeChatCursor(result.nextCursor!)).toEqual({
      createdAt,
      messageId: 'message-1',
    });

    const sql = mockQueryRaw.mock.calls[0]?.[0] as {
      strings: string[];
      values: unknown[];
    };
    expect(sql.strings.join('?')).toContain('WITH "peerIds" AS MATERIALIZED');
    expect(sql.strings.join('?')).toContain('LIMIT ?');
    expect(sql.values).toContain('viewer');
    expect(sql.values).toContain(2);
  });

  it('adds both timestamp and message id to the next-page predicate', async () => {
    mockQueryRaw.mockResolvedValue([]);
    const cursor = encodeChatCursor(createdAt, 'message-boundary');

    await chatService.listConversations('viewer', 30, cursor);

    const sql = mockQueryRaw.mock.calls[0]?.[0] as {
      strings: string[];
      values: unknown[];
    };
    expect(sql.strings.join('?')).toContain(
      `(date_trunc('milliseconds', latest."createdAt"), latest."id") < (?, ?)`,
    );
    expect(sql.values).toContainEqual(createdAt);
    expect(sql.values).toContain('message-boundary');
  });

  it('rejects an invalid cursor before querying PostgreSQL', async () => {
    await expect(chatService.listConversations('viewer', 30, 'bad-cursor')).rejects.toMatchObject({
      code: 'VALIDATION_001',
      status: 400,
    });
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });
});
