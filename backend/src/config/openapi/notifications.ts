import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import type { OpenApiComponents } from './components';

export const registerNotificationsPaths = (
  registry: OpenAPIRegistry,
  { SuccessVoid }: OpenApiComponents,
): void => {
  registry.registerPath({
    method: 'get',
    path: '/api/notifications',
    tags: ['Notifications'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Paginated notification feed.',
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
