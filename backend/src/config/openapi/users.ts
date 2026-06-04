import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { locationSchema, updateMeSchema, visibilitySchema } from '../../modules/users/users.schema';
import type { OpenApiComponents } from './components';

export const registerUsersPaths = (
  registry: OpenAPIRegistry,
  { SuccessVoid, UserPublic }: OpenApiComponents,
): void => {
  registry.registerPath({
    method: 'get',
    path: '/api/users/me',
    tags: ['Users'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Current user profile (includes private fields like email, location).',
        content: {
          'application/json': {
            schema: z.object({ success: z.literal(true), data: UserPublic }),
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/users/me',
    tags: ['Users'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: updateMeSchema } } } },
    responses: {
      200: {
        description: 'Updated user profile.',
        content: {
          'application/json': {
            schema: z.object({ success: z.literal(true), data: UserPublic }),
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/users/me/visibility',
    tags: ['Users'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: visibilitySchema } } } },
    responses: {
      200: {
        description: 'Ghost Mode toggled.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: z.object({ id: z.string(), isVisible: z.boolean() }),
            }),
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/users/me/location',
    tags: ['Users'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: locationSchema } } } },
    responses: {
      200: {
        description: 'GPS coordinates updated, lastSeenAt bumped.',
        content: { 'application/json': { schema: SuccessVoid } },
      },
    },
  });
};
