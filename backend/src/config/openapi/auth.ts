import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
} from '../../modules/auth/auth.schema';
import type { OpenApiComponents } from './components';

export const registerAuthPaths = (
  registry: OpenAPIRegistry,
  { ErrorBody, SuccessVoid, TokenPair }: OpenApiComponents,
): void => {
  registry.registerPath({
    method: 'post',
    path: '/api/auth/register',
    tags: ['Auth'],
    request: { body: { content: { 'application/json': { schema: registerSchema } } } },
    responses: {
      201: {
        description: 'User created, token pair issued.',
        content: {
          'application/json': {
            schema: z.object({ success: z.literal(true), data: TokenPair }),
          },
        },
      },
      409: {
        description: 'Email or username already taken',
        content: { 'application/json': { schema: ErrorBody } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/login',
    tags: ['Auth'],
    request: { body: { content: { 'application/json': { schema: loginSchema } } } },
    responses: {
      200: {
        description: 'Token pair issued.',
        content: {
          'application/json': {
            schema: z.object({ success: z.literal(true), data: TokenPair }),
          },
        },
      },
      401: {
        description: 'Invalid credentials',
        content: { 'application/json': { schema: ErrorBody } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/refresh',
    tags: ['Auth'],
    request: { body: { content: { 'application/json': { schema: refreshSchema } } } },
    responses: {
      200: {
        description: 'Rotated token pair.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: z.object({
                accessToken: z.string(),
                refreshToken: z.string(),
              }),
            }),
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/logout',
    tags: ['Auth'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Access token blacklisted.',
        content: { 'application/json': { schema: SuccessVoid } },
      },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorBody } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/forgot-password',
    tags: ['Auth'],
    request: { body: { content: { 'application/json': { schema: forgotPasswordSchema } } } },
    responses: {
      200: {
        description: 'Always 200 (anti-enumeration). Reset token emailed if the account exists.',
        content: { 'application/json': { schema: SuccessVoid } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/reset-password',
    tags: ['Auth'],
    request: { body: { content: { 'application/json': { schema: resetPasswordSchema } } } },
    responses: {
      200: {
        description: 'Password updated, refresh tokens revoked.',
        content: { 'application/json': { schema: SuccessVoid } },
      },
      401: {
        description: 'Invalid or expired token',
        content: { 'application/json': { schema: ErrorBody } },
      },
    },
  });
};
