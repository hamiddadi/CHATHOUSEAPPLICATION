import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { createClubSchema, listClubsSchema, inviteSchema } from '../../modules/clubs/clubs.schema';
import type { OpenApiComponents } from './components';

export const registerClubsPaths = (
  registry: OpenAPIRegistry,
  { ErrorBody, SuccessVoid }: OpenApiComponents,
): void => {
  registry.registerPath({
    method: 'get',
    path: '/api/clubs',
    tags: ['Clubs'],
    security: [{ bearerAuth: [] }],
    request: { query: listClubsSchema },
    responses: {
      200: {
        description: 'Paginated list of clubs.',
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
    path: '/api/clubs',
    tags: ['Clubs'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: createClubSchema } } } },
    responses: {
      201: {
        description: 'Club created.',
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
    path: '/api/clubs/{id}/invite',
    tags: ['Clubs'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: inviteSchema } } },
    },
    responses: {
      200: {
        description: 'Invitation sent.',
        content: { 'application/json': { schema: SuccessVoid } },
      },
      403: {
        description: 'Invitation required',
        content: { 'application/json': { schema: ErrorBody } },
      },
    },
  });
};
