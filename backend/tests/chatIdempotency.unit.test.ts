const mockRunIdempotentCreate = jest.fn();
const mockEmitChatMessage = jest.fn();
const mockCreateNotification = jest.fn();
const mockScheduleBackgroundTask = jest.fn();
const mockAssertCanDirectMessageWithinTransaction = jest.fn();
const mockAssertOwnedMediaUrlWithinTransaction = jest.fn();
const mockTransactionMessageCreate = jest.fn();
const mockTransactionNotificationCreate = jest.fn();
const mockTransactionOutboxCreateMany = jest.fn();
const mockWakeMessageDelivery = jest.fn();
const mockWakeNotificationDelivery = jest.fn();
const mockPeerLookup = jest.fn();
const mockSenderLookup = jest.fn();
const mockMessageLookup = jest.fn();

jest.mock('../src/config/database', () => ({
  prisma: {
    user: {
      findFirst: (...args: unknown[]) => mockPeerLookup(...args),
      findUnique: (...args: unknown[]) => mockSenderLookup(...args),
    },
    message: { findUnique: (...args: unknown[]) => mockMessageLookup(...args) },
  },
}));
jest.mock('../src/config/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));
jest.mock('../src/utils/idempotency', () => ({
  runIdempotentCreate: (...args: unknown[]) => mockRunIdempotentCreate(...args),
}));
jest.mock('../src/socket/realtime', () => ({
  emitChatMessage: (...args: unknown[]) => mockEmitChatMessage(...args),
}));
jest.mock('../src/modules/notifications/notifications.service', () => ({
  notificationsService: {
    create: (...args: unknown[]) => mockCreateNotification(...args),
  },
}));
jest.mock('../src/utils/backgroundTasks', () => ({
  scheduleBackgroundTask: (...args: unknown[]) => mockScheduleBackgroundTask(...args),
}));
jest.mock('../src/modules/chat/message.outbox', () => ({
  messageDeliveryOutboxData: (kind: string, messageId: string) => ({
    eventKey: `message:${kind}:${messageId}`,
  }),
  wakeMessageDelivery: (...args: unknown[]) => mockWakeMessageDelivery(...args),
}));
jest.mock('../src/modules/notifications/notification.outbox', () => ({
  notificationDeliveryOutboxData: (notificationId: string) => ({
    eventKey: `notification:${notificationId}`,
  }),
  wakeNotificationDelivery: (...args: unknown[]) => mockWakeNotificationDelivery(...args),
}));
jest.mock('../src/modules/chat/chat.policy', () => ({
  assertCanDirectMessageWithinTransaction: (...args: unknown[]) =>
    mockAssertCanDirectMessageWithinTransaction(...args),
}));
jest.mock('../src/modules/media/media.service', () => ({
  mediaService: {
    canonicalizeVoiceMediaUrl: (url: string) => url,
    assertOwnedMediaUrlWithinTransaction: (...args: unknown[]) =>
      mockAssertOwnedMediaUrlWithinTransaction(...args),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chatService } =
  require('../src/modules/chat/chat.service') as typeof import('../src/modules/chat/chat.service');

const winner = {
  id: 'winning-message',
  senderId: 'sender-1',
  receiverId: 'receiver-1',
  content: 'hello',
  kind: 'TEXT',
  audioUrl: null,
  audioDurationMs: null,
  roomId: null,
  isRead: false,
  createdAt: new Date('2026-08-10T12:00:00.000Z'),
  sender: {
    id: 'sender-1',
    username: 'sender',
    displayName: 'Sender',
    avatarUrl: null,
  },
};

describe('chatService idempotent fan-out', () => {
  beforeEach(() => {
    mockPeerLookup.mockResolvedValue({
      id: 'receiver-1',
      username: 'receiver',
      displayName: 'Receiver',
    });
    mockSenderLookup.mockResolvedValue({ username: 'sender', displayName: 'Sender' });
    mockMessageLookup.mockResolvedValue(winner);
    mockAssertCanDirectMessageWithinTransaction.mockResolvedValue(undefined);
    mockAssertOwnedMediaUrlWithinTransaction.mockResolvedValue('voice-media-1');
    mockTransactionMessageCreate.mockResolvedValue({ id: winner.id });
    mockTransactionNotificationCreate.mockResolvedValue({ id: 'notification-1' });
    mockTransactionOutboxCreateMany.mockResolvedValue({ count: 2 });
    mockWakeMessageDelivery.mockResolvedValue(1);
    mockWakeNotificationDelivery.mockResolvedValue(1);
    mockCreateNotification.mockResolvedValue({ id: 'notification-1' });
    mockScheduleBackgroundTask.mockResolvedValue(undefined);
  });

  it('returns the winning text resource without re-emitting socket or notification side effects', async () => {
    mockRunIdempotentCreate
      .mockResolvedValueOnce({ resourceId: winner.id, replayed: false })
      .mockResolvedValueOnce({ resourceId: winner.id, replayed: true });

    const first = await chatService.send(
      'sender-1',
      'receiver-1',
      { content: 'hello' },
      'dm-text-key-123',
    );
    const replay = await chatService.send(
      'sender-1',
      'receiver-1',
      { content: 'hello' },
      'dm-text-key-123',
    );

    expect(first.id).toBe(winner.id);
    expect(replay.id).toBe(winner.id);
    expect(mockRunIdempotentCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: 'sender-1',
        scope: 'chat.message:receiver-1',
        key: 'dm-text-key-123',
        payload: { kind: 'TEXT', content: 'hello' },
      }),
    );
    expect(mockEmitChatMessage).not.toHaveBeenCalled();
    expect(mockWakeMessageDelivery).toHaveBeenCalledTimes(2);
    expect(mockWakeNotificationDelivery).toHaveBeenCalledTimes(2);
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockScheduleBackgroundTask).toHaveBeenCalledTimes(2);
  });

  it('returns the winning voice resource without re-emitting socket or notification side effects', async () => {
    const voiceWinner = {
      ...winner,
      content: null,
      kind: 'VOICE',
      audioUrl: 'https://api.example.test/media/voice/signed',
      audioDurationMs: 4_250,
    };
    mockMessageLookup.mockResolvedValue(voiceWinner);
    const transaction = {
      message: { create: mockTransactionMessageCreate },
      notification: { create: mockTransactionNotificationCreate },
      outboxEvent: { createMany: mockTransactionOutboxCreateMany },
    };
    mockRunIdempotentCreate
      .mockImplementationOnce(
        async (options: { create: (tx: typeof transaction) => Promise<string> }) => {
          await options.create(transaction);
          return { resourceId: winner.id, replayed: false };
        },
      )
      .mockResolvedValueOnce({ resourceId: winner.id, replayed: true });
    const input = { audioUrl: voiceWinner.audioUrl, durationMs: voiceWinner.audioDurationMs };

    const first = await chatService.sendVoice('sender-1', 'receiver-1', input, 'dm-voice-key-123');
    const replay = await chatService.sendVoice('sender-1', 'receiver-1', input, 'dm-voice-key-123');

    expect(first.id).toBe(winner.id);
    expect(replay.id).toBe(winner.id);
    expect(mockRunIdempotentCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: 'sender-1',
        scope: 'chat.message:receiver-1',
        key: 'dm-voice-key-123',
        payload: { kind: 'VOICE', ...input },
      }),
    );
    expect(mockAssertOwnedMediaUrlWithinTransaction).toHaveBeenCalledTimes(1);
    expect(mockAssertOwnedMediaUrlWithinTransaction).toHaveBeenCalledWith(
      transaction,
      'sender-1',
      input.audioUrl,
      'VOICE',
    );
    expect(mockTransactionMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mediaObjectId: 'voice-media-1' }),
      }),
    );
    expect(mockEmitChatMessage).not.toHaveBeenCalled();
    expect(mockWakeMessageDelivery).toHaveBeenCalledTimes(2);
    expect(mockWakeNotificationDelivery).toHaveBeenCalledTimes(2);
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockScheduleBackgroundTask).toHaveBeenCalledTimes(2);
  });
});
