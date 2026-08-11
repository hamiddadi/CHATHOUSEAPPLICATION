import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import type { OpenApiComponents } from './components';

export const registerFollowPaths = (
  registry: OpenAPIRegistry,
  { ErrorBody, UserPublic }: OpenApiComponents,
): void => {
  const params = z.object({ userId: z.string().min(1) });
  const query = z.object({
    limit: z.coerce.number().int().min(1).max(50).default(50),
    cursor: z.string().max(1024).optional(),
  });
  const page = z.object({
    data: z.array(
      UserPublic.extend({
        isFollowedByMe: z.boolean().optional(),
        followRequestedByMe: z.boolean().optional(),
      }),
    ),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  });

  for (const path of ['/api/follow/followers', '/api/follow/following'] as const) {
    registry.registerPath({
      method: 'get',
      path,
      tags: ['Follow'],
      security: [{ bearerAuth: [] }],
      request: { query },
      responses: {
        200: {
          description: 'Accepted follow relations only.',
          content: {
            'application/json': {
              schema: z.object({ success: z.literal(true), data: page }),
            },
          },
        },
      },
    });
  }

  registry.registerPath({
    method: 'get',
    path: '/api/follow/requests',
    tags: ['Follow'],
    security: [{ bearerAuth: [] }],
    request: { query },
    responses: {
      200: {
        description: 'Pending requests addressed to the authenticated private account.',
        content: {
          'application/json': {
            schema: z.object({ success: z.literal(true), data: page }),
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/follow/{userId}',
    tags: ['Follow'],
    security: [{ bearerAuth: [] }],
    request: { params },
    responses: {
      200: {
        description:
          'Creates an accepted public follow or a pending private-account request. Replays are idempotent.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: z.object({
                following: z.boolean(),
                requested: z.boolean().optional(),
              }),
            }),
          },
        },
      },
      403: {
        description: 'Self-follow or a block exists in either direction',
        content: { 'application/json': { schema: ErrorBody } },
      },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/follow/{userId}',
    tags: ['Follow'],
    security: [{ bearerAuth: [] }],
    request: { params },
    responses: {
      200: {
        description: 'Removes an accepted follow or pending request; repeated calls are no-ops.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: z.object({ following: z.literal(false) }),
            }),
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/follow/{userId}/accept',
    tags: ['Follow'],
    security: [{ bearerAuth: [] }],
    request: { params },
    responses: {
      200: {
        description: 'Atomically promotes PENDING to ACCEPTED and updates counters once.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: z.object({ accepted: z.literal(true) }),
            }),
          },
        },
      },
      404: {
        description:
          'No follow relation exists. An already accepted relation is an idempotent 200.',
        content: { 'application/json': { schema: ErrorBody } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/follow/{userId}/reject',
    tags: ['Follow'],
    security: [{ bearerAuth: [] }],
    request: { params },
    responses: {
      200: {
        description: 'Removes a pending request and its notification.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: z.object({ rejected: z.boolean() }),
            }),
          },
        },
      },
    },
  });
};
