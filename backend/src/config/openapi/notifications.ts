import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import type { OpenApiComponents } from './components';

export const registerNotificationsPaths = (
  registry: OpenAPIRegistry,
  { SuccessVoid }: OpenApiComponents,
): void => {
  const notificationType = z.enum([
    'ROOM_INVITE',
    'NEW_FOLLOWER',
    'ROOM_STARTED',
    'SPEAKER_REQUEST',
    'MENTION',
    'CLUB_INVITE',
    'WAVE',
    'HAND_ACCEPTED',
    'RSVP_REMINDER',
    'NEW_MESSAGE',
    'ROOM_CANCELED',
    'ROOM_ENDED_BY_ADMIN',
    'FOLLOW_REQUEST',
  ]);

  registry.registerPath({
    method: 'get',
    path: '/api/notifications',
    tags: ['Notifications'],
    security: [{ bearerAuth: [] }],
    request: {
      query: z.object({
        filter: z.enum(['all', 'rooms', 'social', 'clubs']).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(50),
        cursor: z.string().max(1024).optional(),
      }),
    },
    responses: {
      200: {
        description: 'Paginated notification feed.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: z.array(
                z
                  .object({
                    id: z.string(),
                    type: notificationType,
                    actorId: z.string().nullable(),
                    targetId: z.string().nullable(),
                    targetType: z.string().nullable(),
                    title: z.string(),
                    body: z.string(),
                    data: z.record(z.unknown()).nullable().optional(),
                    isRead: z.boolean(),
                    createdAt: z.string().datetime(),
                  })
                  .passthrough(),
              ),
              nextCursor: z.string().nullable(),
              hasMore: z.boolean(),
            }),
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/notifications/read-all',
    tags: ['Notifications'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'All notifications marked read.',
        content: { 'application/json': { schema: SuccessVoid } },
      },
    },
  });
};
