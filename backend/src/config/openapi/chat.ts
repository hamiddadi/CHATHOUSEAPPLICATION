import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  sendMessageSchema,
  sendVoiceMessageSchema,
  listMessagesSchema,
} from '../../modules/chat/chat.schema';
import {
  contentReportResultSchema,
  contentReportSchema,
} from '../../modules/reports/contentReports.schema';
import type { OpenApiComponents } from './components';

export const registerChatPaths = (
  registry: OpenAPIRegistry,
  { ErrorBody }: OpenApiComponents,
): void => {
  const idempotencyHeaders = z.object({
    'Idempotency-Key': z.string().min(8).max(128).optional(),
  });
  const genericMessage = z.object({ id: z.string() }).passthrough();
  const messageListResponse = z.union([
    z.object({
      success: z.literal(true),
      data: z.array(genericMessage),
    }),
    z.object({
      success: z.literal(true),
      data: z.object({
        data: z.array(genericMessage),
        nextCursor: z.string().nullable(),
        hasMore: z.boolean(),
      }),
    }),
  ]);

  registry.registerPath({
    method: 'get',
    path: '/api/chat/{userId}',
    tags: ['Chat'],
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ userId: z.string() }), query: listMessagesSchema },
    responses: {
      200: {
        description:
          'Direct-message thread with a peer. Returns the legacy message array by default, or a { data, nextCursor, hasMore } page when paginated=true.',
        content: {
          'application/json': {
            schema: messageListResponse,
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/chat/{userId}',
    tags: ['Chat'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ userId: z.string() }),
      headers: idempotencyHeaders,
      body: { content: { 'application/json': { schema: sendMessageSchema } } },
    },
    responses: {
      201: {
        description:
          'Persists the text message exactly once per Idempotency-Key. Realtime and push arrival are best effort; consumers must deduplicate delivery attempts with messageId and notificationId.',
        content: {
          'application/json': {
            schema: z.object({ success: z.literal(true), data: z.object({}).passthrough() }),
          },
        },
      },
      403: {
        description: 'Blocked / not allowed',
        content: { 'application/json': { schema: ErrorBody } },
      },
      409: {
        description: 'Idempotency key reused with another payload or DM kind',
        content: { 'application/json': { schema: ErrorBody } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/chat/{userId}/voice',
    tags: ['Chat'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ userId: z.string() }),
      headers: idempotencyHeaders,
      body: { content: { 'application/json': { schema: sendVoiceMessageSchema } } },
    },
    responses: {
      201: {
        description:
          'Persists the voice message exactly once per Idempotency-Key. Realtime and push arrival are best effort; consumers must deduplicate delivery attempts with messageId and notificationId.',
        content: {
          'application/json': {
            schema: z.object({ success: z.literal(true), data: z.object({}).passthrough() }),
          },
        },
      },
      403: {
        description: 'Blocked / not allowed',
        content: { 'application/json': { schema: ErrorBody } },
      },
      409: {
        description: 'Idempotency key reused with another payload or DM kind',
        content: { 'application/json': { schema: ErrorBody } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/chat/messages/{messageId}/report',
    tags: ['Chat', 'Moderation'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ messageId: z.string().min(1) }),
      body: { content: { 'application/json': { schema: contentReportSchema } } },
    },
    responses: {
      201: {
        description:
          'Queues immutable evidence for a received direct message. Retries return the existing report.',
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
};
