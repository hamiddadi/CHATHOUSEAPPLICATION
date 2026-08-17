import { apiClient } from '../../../shared/services/api/apiClient';
import { notificationService } from './notificationService';

const raw = (id: string, createdAt: string) => ({
  id,
  userId: 'viewer-1',
  type: 'NEW_FOLLOWER' as const,
  title: 'New follower',
  body: `${id} followed you`,
  data: { followerId: id },
  isRead: false,
  createdAt,
});

describe('notificationService pagination', () => {
  afterEach(() => jest.restoreAllMocks());

  it('passes an opaque cursor and preserves server paging metadata', async () => {
    const cursor = 'v1.current';
    const nextCursor = 'v1.next';
    const get = jest.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        success: true,
        data: [raw('actor-1', '2026-08-10T12:00:00.000Z')],
        nextCursor,
        hasMore: true,
      },
    });

    const page = await notificationService.list('social', cursor);

    expect(get).toHaveBeenCalledWith('/notifications', {
      params: { filter: 'social', cursor },
    });
    expect(page).toMatchObject({
      nextCursor,
      hasMore: true,
      items: [{ id: 'actor-1', kind: 'follow' }],
    });
  });

  it('keeps compatibility with an array-only backend via its legacy ISO cursor', async () => {
    const rows = Array.from({ length: 50 }, (_, index) =>
      raw(`actor-${index}`, new Date(Date.UTC(2026, 7, 10, 12, 0, index)).toISOString()),
    );
    jest.spyOn(apiClient, 'get').mockResolvedValue({
      data: { success: true, data: rows },
    });

    const page = await notificationService.list();

    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe(rows[rows.length - 1]!.createdAt);
    expect(page.items).toHaveLength(50);
  });

  it('maps actionable and terminal kinds with safe top-level target fallbacks', async () => {
    jest.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        success: true,
        data: [
          {
            ...raw('wrong-data-actor', '2026-08-10T12:00:00.000Z'),
            id: 'follow-request',
            type: 'FOLLOW_REQUEST',
            actorId: 'top-level-actor',
          },
          {
            ...raw('actor-2', '2026-08-10T11:00:00.000Z'),
            id: 'room-canceled',
            type: 'ROOM_CANCELED',
            data: null,
            targetId: 'room-from-target',
            targetType: 'room',
          },
          {
            ...raw('actor-3', '2026-08-10T10:00:00.000Z'),
            id: 'room-ended',
            type: 'ROOM_ENDED_BY_ADMIN',
            data: { roomId: 'room-from-data' },
          },
          {
            ...raw('actor-4', '2026-08-10T09:00:00.000Z'),
            id: 'house-target',
            type: 'CLUB_INVITE',
            data: null,
            targetId: 'house-from-target',
            targetType: 'club',
          },
          {
            ...raw('group-sender', '2026-08-10T08:00:00.000Z'),
            id: 'group-message',
            type: 'NEW_MESSAGE',
            data: {
              senderId: 'group-sender',
              conversationId: 'group-42',
              conversation: 'group',
            },
          },
        ],
        nextCursor: null,
        hasMore: false,
      },
    });

    const page = await notificationService.list();

    expect(page.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'follow-request',
          kind: 'follow_request',
          actor: expect.objectContaining({ id: 'top-level-actor' }),
        }),
        expect.objectContaining({
          id: 'room-canceled',
          kind: 'room_canceled',
          roomId: 'room-from-target',
        }),
        expect.objectContaining({
          id: 'room-ended',
          kind: 'room_ended_by_admin',
          roomId: 'room-from-data',
        }),
        expect.objectContaining({ id: 'house-target', houseId: 'house-from-target' }),
        expect.objectContaining({
          id: 'group-message',
          kind: 'new_message',
          conversationId: 'group-42',
          conversationType: 'group',
        }),
      ]),
    );
  });
});
