import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { sendMessageSchema, listMessagesSchema } from '../../modules/chat/chat.schema';
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
};
