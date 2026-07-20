import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { locationSchema, updateMeSchema, visibilitySchema } from '../../modules/users/users.schema';
import type { OpenApiComponents } from './components';

export const registerUsersPaths = (
  registry: OpenAPIRegistry,
  { ErrorBody, SuccessVoid, UserPublic }: OpenApiComponents,
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
    method: 'post',
    path: '/api/users/me/request-deletion',
    tags: ['Users', 'Privacy'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description:
          'Immediately disables the account and starts the configured 30-day deletion grace period.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: z.object({
                deletedAt: z.string().datetime(),
                permanentDeletionAt: z.string().datetime(),
              }),
            }),
          },
        },
      },
      409: {
        description: 'Deletion already scheduled',
        content: { 'application/json': { schema: ErrorBody } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/users/me/cancel-deletion',
    tags: ['Users', 'Privacy'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Cancels a self-requested deletion; moderation bans cannot be restored.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: z.object({ cancelled: z.literal(true) }),
            }),
          },
        },
      },
      403: {
        description: 'Account is under an active moderation suspension',
        content: { 'application/json': { schema: ErrorBody } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/users/me/export',
    tags: ['Users', 'Privacy'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description:
          'GDPR access/portability archive. Secrets, raw push tokens and object-storage keys are excluded.',
        headers: {
          'Content-Disposition': {
            description: 'Attachment filename for the JSON archive.',
            schema: { type: 'string' },
          },
        },
        content: {
          'application/json': {
            schema: z
              .object({
                exportVersion: z.string(),
                generatedAt: z.string().datetime(),
              })
              .passthrough(),
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
