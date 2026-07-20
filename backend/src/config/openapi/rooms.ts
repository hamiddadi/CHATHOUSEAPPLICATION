import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  createRoomSchema,
  listRoomsSchema,
  updateRoleSchema,
  muteSchema,
} from '../../modules/rooms/rooms.schema';
import type { OpenApiComponents } from './components';

export const registerRoomsPaths = (
  registry: OpenAPIRegistry,
  { ErrorBody, SuccessVoid }: OpenApiComponents,
): void => {
  const idempotencyHeaders = z.object({
    'Idempotency-Key': z.string().min(8).max(128).optional(),
  });

  registry.registerPath({
    method: 'get',
    path: '/api/rooms',
    tags: ['Rooms'],
    security: [{ bearerAuth: [] }],
    request: { query: listRoomsSchema },
    responses: {
      200: {
        description: 'Paginated list of rooms.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: z.array(z.object({}).passthrough()),
            }),
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/rooms',
    tags: ['Rooms'],
    security: [{ bearerAuth: [] }],
    request: {
      headers: idempotencyHeaders,
      body: { content: { 'application/json': { schema: createRoomSchema } } },
    },
    responses: {
      201: {
        description: 'Room created.',
        content: {
          'application/json': {
            schema: z.object({ success: z.literal(true), data: z.object({}).passthrough() }),
          },
        },
      },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorBody } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/rooms/{id}/join',
    tags: ['Rooms'],
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: 'Joined room; returns participant list.',
        content: {
          'application/json': {
            schema: z.object({ success: z.literal(true), data: z.object({}).passthrough() }),
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/rooms/{id}/leave',
    tags: ['Rooms'],
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: 'Leaves the room. Repeated calls are successful no-ops.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: z.object({ left: z.literal(true) }),
            }),
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/rooms/{id}/end',
    tags: ['Rooms'],
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: 'Ends a live room and disconnects its media session.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: z.object({ ended: z.literal(true) }),
            }),
          },
        },
      },
      403: {
        description: 'Caller is not the host',
        content: { 'application/json': { schema: ErrorBody } },
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/rooms/{id}/role',
    tags: ['Rooms'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: updateRoleSchema } } },
    },
    responses: {
      200: {
        description: 'Role updated.',
        content: { 'application/json': { schema: SuccessVoid } },
      },
      403: {
        description: 'Not a moderator',
        content: { 'application/json': { schema: ErrorBody } },
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/rooms/{id}/mute',
    tags: ['Rooms'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: muteSchema } } },
    },
    responses: {
      200: {
        description: 'Mute state changed.',
        content: { 'application/json': { schema: SuccessVoid } },
      },
    },
  });
};
