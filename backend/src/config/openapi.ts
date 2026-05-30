import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
} from '../modules/auth/auth.schema';
import { locationSchema, updateMeSchema, visibilitySchema } from '../modules/users/users.schema';
import {
  createRoomSchema,
  listRoomsSchema,
  updateRoleSchema,
  muteSchema,
} from '../modules/rooms/rooms.schema';
import { sendMessageSchema, listMessagesSchema } from '../modules/chat/chat.schema';
import { createClubSchema, listClubsSchema, inviteSchema } from '../modules/clubs/clubs.schema';
import { searchSchema } from '../modules/search/search.schema';

// Register the `.openapi()` method on every Zod schema.
extendZodWithOpenApi(z);

/**
 * OpenAPI document generator. Phase 7c documents the auth + users slices —
 * the remaining modules (rooms, chat, maps, notifications) follow the same
 * pattern:
 *   1. `registry.registerPath({ method, path, request, responses })`
 *   2. Describe `request.body`/`request.query` with their existing Zod schemas
 * Everything else (ErrorResponse, auth bearer scheme) is already wired here.
 */
export const buildOpenApiDocument = () => {
  const registry = new OpenAPIRegistry();

  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });

  const ErrorBody = registry.register(
    'ErrorResponse',
    z.object({
      success: z.literal(false),
      error: z.object({
        code: z.string(),
        message: z.string(),
      }),
    }),
  );
  const SuccessVoid = registry.register(
    'SuccessOk',
    z.object({ success: z.literal(true), data: z.object({ ok: z.boolean() }) }),
  );

  const UserPublic = registry.register(
    'UserPublic',
    z.object({
      id: z.string(),
      username: z.string(),
      displayName: z.string().nullable(),
      avatarUrl: z.string().url().nullable(),
      bio: z.string().nullable(),
      isOnline: z.boolean(),
      createdAt: z.string().datetime(),
    }),
  );

  const TokenPair = registry.register(
    'TokenPair',
    z.object({
      user: UserPublic.extend({ email: z.string().email() }),
      accessToken: z.string(),
      refreshToken: z.string(),
    }),
  );

  // ─── AUTH ───────────────────────────────────────────
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

  // ─── USERS (subset) ─────────────────────────────────
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

  // ─── ROOMS ──────────────────────────────────────────
  registry.registerPath({
    method: 'get',
    path: '/api/rooms',
    tags: ['Rooms'],
    security: [{ bearerAuth: [] }],
    request: { query: listRoomsSchema },
    responses: {
      200: {
        description: 'Paginated list of rooms.',
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
    path: '/api/rooms',
    tags: ['Rooms'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: createRoomSchema } } } },
    responses: {
      201: {
        description: 'Room created.',
        content: {
          'application/json': {
            schema: z.object({ success: z.literal(true), data: z.object({}).passthrough() }),
          },
        },
      },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorBody } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/rooms/{id}/join',
    tags: ['Rooms'],
    security: [{ bearerAuth: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: 'Joined room; returns participant list.',
        content: {
          'application/json': {
            schema: z.object({ success: z.literal(true), data: z.object({}).passthrough() }),
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/rooms/{id}/role',
    tags: ['Rooms'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: updateRoleSchema } } },
    },
    responses: {
      200: {
        description: 'Role updated.',
        content: { 'application/json': { schema: SuccessVoid } },
      },
      403: {
        description: 'Not a moderator',
        content: { 'application/json': { schema: ErrorBody } },
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/rooms/{id}/mute',
    tags: ['Rooms'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: muteSchema } } },
    },
    responses: {
      200: {
        description: 'Mute state changed.',
        content: { 'application/json': { schema: SuccessVoid } },
      },
    },
  });

  // ─── CHAT ───────────────────────────────────────────
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

  // ─── CLUBS ──────────────────────────────────────────
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

  // ─── SEARCH ─────────────────────────────────────────
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

  // ─── NOTIFICATIONS ──────────────────────────────────
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

  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Chathouse API',
      version: '0.1.0',
      description:
        'Auth, Users, Rooms, Chat, Clubs, Search and Notifications documented. Remaining modules (Maps, Explore, Push, Admin, /api/ext/*) follow the same pattern — `registry.registerPath(...)` per endpoint using their existing Zod schemas.',
    },
    servers: [
      { url: 'https://api.chathouse.app', description: 'prod' },
      { url: 'http://localhost:4000', description: 'dev' },
    ],
  });
};
