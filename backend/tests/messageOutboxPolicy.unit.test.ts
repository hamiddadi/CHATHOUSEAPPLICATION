const mockMessageFindFirst = jest.fn();
const mockGroupMessageFindUnique = jest.fn();
const mockUserFindMany = jest.fn();
const mockBlockFindFirst = jest.fn();
const mockBlockFindMany = jest.fn();
const mockEmitChatMessageToUsers = jest.fn();
const mockEmitGroupMessage = jest.fn();
const mockRegisterOutboxHandler = jest.fn();

jest.mock('../src/config/database', () => ({
  prisma: {
    message: { findFirst: (...args: unknown[]) => mockMessageFindFirst(...args) },
    groupMessage: { findUnique: (...args: unknown[]) => mockGroupMessageFindUnique(...args) },
    user: { findMany: (...args: unknown[]) => mockUserFindMany(...args) },
    block: {
      findFirst: (...args: unknown[]) => mockBlockFindFirst(...args),
      findMany: (...args: unknown[]) => mockBlockFindMany(...args),
    },
  },
}));

jest.mock('../src/socket/realtime', () => ({
  emitChatMessageToUsers: (...args: unknown[]) => mockEmitChatMessageToUsers(...args),
  emitGroupMessage: (...args: unknown[]) => mockEmitGroupMessage(...args),
}));

jest.mock('../src/workers/outbox.worker', () => ({
  registerOutboxHandler: (...args: unknown[]) => mockRegisterOutboxHandler(...args),
  wakeAndProcessOutbox: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { _internals } =
  require('../src/modules/chat/message.outbox') as typeof import('../src/modules/chat/message.outbox');

const eventFor = (messageId: string) => ({ payload: { messageId } }) as never;

const sender = {
  id: 'sender-1',
  username: 'sender',
  displayName: 'Sender',
  avatarUrl: null,
};

describe('message outbox delivery policy', () => {
  beforeEach(() => {
    mockMessageFindFirst.mockReset();
    mockGroupMessageFindUnique.mockReset();
    mockUserFindMany.mockReset();
    mockBlockFindFirst.mockReset();
    mockBlockFindMany.mockReset();
    mockEmitChatMessageToUsers.mockReset();
    mockEmitGroupMessage.mockReset();
  });

  it('does not deliver a direct message to a peer who blocked before the claim', async () => {
    mockMessageFindFirst.mockResolvedValue({
      id: 'message-1',
      senderId: sender.id,
      receiverId: 'receiver-1',
      sender,
    });
    mockUserFindMany.mockResolvedValue([{ id: sender.id }, { id: 'receiver-1' }]);
    mockBlockFindFirst.mockResolvedValue({ id: 'block-1' });

    await _internals.deliverDirectMessage(eventFor('message-1'));

    expect(mockEmitChatMessageToUsers).toHaveBeenCalledWith([sender.id], expect.any(Object));
  });

  it('suppresses a direct fanout when the sender became inactive before the claim', async () => {
    mockMessageFindFirst.mockResolvedValue({
      id: 'message-2',
      senderId: sender.id,
      receiverId: 'receiver-1',
      sender,
    });
    mockUserFindMany.mockResolvedValue([{ id: 'receiver-1' }]);
    mockBlockFindFirst.mockResolvedValue(null);

    await _internals.deliverDirectMessage(eventFor('message-2'));

    expect(mockEmitChatMessageToUsers).not.toHaveBeenCalled();
  });

  it('filters blocked group recipients at delivery time', async () => {
    mockGroupMessageFindUnique.mockResolvedValue({
      id: 'message-3',
      conversationId: 'group-1',
      senderId: sender.id,
      kind: 'TEXT',
      content: 'hello',
      audioUrl: null,
      audioDurationMs: null,
      createdAt: new Date('2026-08-10T12:00:00.000Z'),
      sender,
      conversation: {
        members: [{ userId: sender.id }, { userId: 'blocked-1' }, { userId: 'member-1' }],
      },
    });
    mockBlockFindMany.mockResolvedValue([{ blockerId: 'blocked-1', blockedId: sender.id }]);

    await _internals.deliverGroupMessage(eventFor('message-3'));

    expect(mockEmitGroupMessage).toHaveBeenCalledWith(
      [sender.id, 'member-1'],
      expect.objectContaining({ id: 'message-3', conversationId: 'group-1' }),
    );
  });

  it('suppresses a group fanout when the sender is no longer an active member', async () => {
    mockGroupMessageFindUnique.mockResolvedValue({
      id: 'message-4',
      conversationId: 'group-1',
      senderId: sender.id,
      sender,
      conversation: { members: [{ userId: 'member-1' }] },
    });

    await _internals.deliverGroupMessage(eventFor('message-4'));

    expect(mockBlockFindMany).not.toHaveBeenCalled();
    expect(mockEmitGroupMessage).not.toHaveBeenCalled();
  });
});
