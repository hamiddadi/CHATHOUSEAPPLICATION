import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { searchSchema } from '../../modules/search/search.schema';

export const registerSearchPaths = (registry: OpenAPIRegistry): void => {
  registry.registerPath({
    method: 'get',
    path: '/api/search',
    tags: ['Search'],
    security: [{ bearerAuth: [] }],
    request: { query: searchSchema },
    responses: {
      200: {
        description: 'Trigram search across users, clubs and rooms.',
        content: {
          'application/json': {
            schema: z.object({ success: z.literal(true), data: z.object({}).passthrough() }),
          },
        },
      },
    },
  });
};
