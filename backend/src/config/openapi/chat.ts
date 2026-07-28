import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { sendMessageSchema, listMessagesSchema } from '../../modules/chat/chat.schema';
import {
  contentReportResultSchema,
  contentReportSchema,
} from '../../modules/reports/contentReports.schema';
import type { OpenApiComponents } from './components';

export const registerChatPaths = (
  registry: OpenAPIRegistry,
  { ErrorBody }: OpenApiComponents,
): void => {
  registry.registerPath({
    method: 'get',
    path: '/api/chat/{userId}',
    tags: ['Chat'],
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ userId: z.string() }), query: listMessagesSchema },
    responses: {
      200: {
        description: 'Direct-message thread with a peer.',
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
    path: '/api/chat/{userId}',
    tags: ['Chat'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ userId: z.string() }),
      body: { content: { 'application/json': { schema: sendMessageSchema } } },
    },
    responses: {
      201: {
        description: 'Message sent.',
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
