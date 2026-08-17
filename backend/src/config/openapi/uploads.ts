import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { uploadBodySchema } from '../../modules/upload/upload.router';
import type { OpenApiComponents } from './components';

export const registerUploadPaths = (
  registry: OpenAPIRegistry,
  { ErrorBody }: OpenApiComponents,
): void => {
  const uploaded = z.object({
    id: z.string(),
    url: z.string().url(),
  });
  const idempotencyHeaders = z.object({
    'Idempotency-Key': z.string().min(8).max(128).optional(),
  });

  for (const kind of ['avatar', 'voice'] as const) {
    registry.registerPath({
      method: 'post',
      path: `/api/upload/${kind}`,
      tags: ['Uploads'],
      security: [{ bearerAuth: [] }],
      request: {
        headers: idempotencyHeaders,
        body: {
          content: {
            'application/json': { schema: uploadBodySchema },
          },
        },
      },
      responses: {
        201: {
          description:
            kind === 'avatar'
              ? 'Validates image magic bytes and stores a private avatar object.'
              : 'Validates audio magic bytes and stores a private voice-message object.',
          content: {
            'application/json': {
              schema: z.object({ success: z.literal(true), data: uploaded }),
            },
          },
        },
        400: {
          description: 'MIME, base64 or file signature is invalid',
          content: { 'application/json': { schema: ErrorBody } },
        },
        413: {
          description: 'Decoded media exceeds the configured limit',
          content: { 'application/json': { schema: ErrorBody } },
        },
        409: {
          description: 'Idempotency key was already used with different media content',
          content: { 'application/json': { schema: ErrorBody } },
        },
        429: {
          description: 'Per-user upload rate exceeded',
          content: { 'application/json': { schema: ErrorBody } },
        },
      },
    });
  }
};
