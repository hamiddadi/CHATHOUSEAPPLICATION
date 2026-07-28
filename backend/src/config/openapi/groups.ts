import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  addGroupMembersSchema,
  createGroupSchema,
  listGroupMessagesSchema,
  sendGroupMessageSchema,
} from '../../modules/groups/groups.schema';
import {
  contentReportResultSchema,
  contentReportSchema,
} from '../../modules/reports/contentReports.schema';
import type { OpenApiComponents } from './components';

export const registerGroupsPaths = (
  registry: OpenAPIRegistry,
  { ErrorBody }: OpenApiComponents,
): void => {
  const idParams = z.object({ id: z.string().min(1) });
  const idempotencyHeaders = z.object({
    'Idempotency-Key': z.string().min(8).max(128).optional(),
  });
  const genericResource = z.object({ id: z.string() }).passthrough();

  registry.registerPath({
    method: 'get',
    path: '/api/groups',
    tags: ['Groups'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Groups containing the authenticated user.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: z.array(genericResource),
            }),
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/groups/{id}/messages/{messageId}/report',
    tags: ['Groups', 'Moderation'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string().min(1), messageId: z.string().min(1) }),
      body: { content: { 'application/json': { schema: contentReportSchema } } },
    },
    responses: {
      201: {
        description: 'Queues immutable evidence for a message visible to a current group member.',
        content: { 'application/json': { schema: contentReportResultSchema } },
      },
      403: {
        description: 'The caller is the message author',
        content: { 'application/json': { schema: ErrorBody } },
      },
      404: {
        description: 'Message missing or not visible to the caller',
        content: { 'application/json': { schema: ErrorBody } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/groups',
    tags: ['Groups'],
    security: [{ bearerAuth: [] }],
    request: {
      headers: idempotencyHeaders,
      body: { content: { 'application/json': { schema: createGroupSchema } } },
    },
    responses: {
      201: {
        description: 'Creates the group atomically. The idempotency key replays the first result.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: genericResource,
            }),
          },
        },
      },
      409: {
        description: 'Idempotency key reused with another payload',
        content: { 'application/json': { schema: ErrorBody } },
      },
      403: {
        description: 'A candidate is blocked or is not followed with ACCEPTED status',
        content: { 'application/json': { schema: ErrorBody } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/groups/{id}/messages',
    tags: ['Groups'],
    security: [{ bearerAuth: [] }],
    request: { params: idParams, query: listGroupMessagesSchema },
    responses: {
      200: {
        description: 'Messages visible to a current group member.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: z.array(genericResource),
            }),
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/groups/{id}/messages',
    tags: ['Groups'],
    security: [{ bearerAuth: [] }],
    request: {
      params: idParams,
      headers: idempotencyHeaders,
      body: {
        content: { 'application/json': { schema: sendGroupMessageSchema } },
      },
    },
    responses: {
      201: {
        description: 'Persists and fans out a text message exactly once for an idempotency key.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: genericResource,
            }),
          },
        },
      },
      403: {
        description: 'Not a member, or a block exists within the group',
        content: { 'application/json': { schema: ErrorBody } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/groups/{id}/members',
    tags: ['Groups'],
    security: [{ bearerAuth: [] }],
    request: {
      params: idParams,
      headers: idempotencyHeaders,
      body: {
        content: { 'application/json': { schema: addGroupMembersSchema } },
      },
    },
    responses: {
      200: {
        description:
          'Adds accepted-follow candidates atomically and replays the first result for an idempotency key.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: genericResource,
            }),
          },
        },
      },
      403: {
        description: 'Not a member, blocked relationship, or ACCEPTED follow missing',
        content: { 'application/json': { schema: ErrorBody } },
      },
      409: {
        description: 'Idempotency key reused with another payload',
        content: { 'application/json': { schema: ErrorBody } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/groups/{id}/leave',
    tags: ['Groups'],
    security: [{ bearerAuth: [] }],
    request: { params: idParams },
    responses: {
      200: {
        description:
          'Leaves atomically, transfers ownership when needed, and treats retries as success.',
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
};
