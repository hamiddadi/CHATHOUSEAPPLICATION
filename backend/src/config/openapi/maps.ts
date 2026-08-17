import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { locationSchema } from '../../modules/users/users.schema';
import type { OpenApiComponents } from './components';

export const registerMapsPaths = (
  registry: OpenAPIRegistry,
  { ErrorBody }: OpenApiComponents,
): void => {
  const mapUser = z.object({
    id: z.string(),
    username: z.string().nullable(),
    displayName: z.string().nullable(),
    avatarUrl: z.string().url().nullable(),
    latitude: z.number(),
    longitude: z.number(),
    lastSeenAt: z.string().datetime(),
    currentRoomId: z.string().nullable(),
    currentRoom: z
      .object({
        id: z.string(),
        title: z.string(),
        isLive: z.boolean(),
      })
      .nullable(),
  });

  registry.registerPath({
    method: 'get',
    path: '/api/maps/users',
    tags: ['Maps'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description:
          'All recently active users who explicitly enabled map visibility, excluding the viewer, deleted accounts and blocks in either direction.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: z.array(mapUser),
            }),
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/maps/location',
    tags: ['Maps'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: locationSchema } } } },
    responses: {
      200: {
        description: 'Stores precise location only when visibility consent is enabled.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: mapUser,
            }),
          },
        },
      },
      403: {
        description: 'Map visibility has not been enabled',
        content: { 'application/json': { schema: ErrorBody } },
      },
      429: {
        description: 'Per-user location update rate exceeded',
        content: { 'application/json': { schema: ErrorBody } },
      },
    },
  });
};
