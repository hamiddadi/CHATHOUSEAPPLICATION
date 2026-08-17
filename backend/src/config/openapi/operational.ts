import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { registerPushSchema, unregisterPushSchema } from '../../modules/push/push.schema';
import type { OpenApiComponents } from './components';

const SuccessAny = z.object({ success: z.literal(true), data: z.unknown() });
const protectedRead = {
  tags: ['Discovery'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Successful authenticated response.',
      content: { 'application/json': { schema: SuccessAny } },
    },
  },
};

/** Public mobile domains that were mounted at runtime but absent from OpenAPI. */
export const registerOperationalPaths = (
  registry: OpenAPIRegistry,
  { ErrorBody }: OpenApiComponents,
): void => {
  registry.registerPath({
    method: 'get',
    path: '/api/explore',
    ...protectedRead,
  });

  registry.registerPath({
    method: 'get',
    path: '/api/recordings',
    tags: ['Recordings'],
    security: [{ bearerAuth: [] }],
    request: { query: z.object({ limit: z.coerce.number().int().min(1).max(50).optional() }) },
    responses: protectedRead.responses,
  });
  for (const path of ['/api/recordings/room/{roomId}', '/api/recordings/users/{userId}'] as const) {
    const parameter = path.includes('{roomId}') ? 'roomId' : 'userId';
    registry.registerPath({
      method: 'get',
      path,
      tags: ['Recordings'],
      security: [{ bearerAuth: [] }],
      request: { params: z.object({ [parameter]: z.string().min(1) }) },
      responses: protectedRead.responses,
    });
  }

  registry.registerPath({
    method: 'post',
    path: '/api/push/register',
    tags: ['Push'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: registerPushSchema } } } },
    responses: {
      200: protectedRead.responses[200],
      409: {
        description: 'The device token belongs to another account.',
        content: { 'application/json': { schema: ErrorBody } },
      },
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/push/unregister',
    tags: ['Push'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: unregisterPushSchema } } } },
    responses: { 200: protectedRead.responses[200] },
  });
};
