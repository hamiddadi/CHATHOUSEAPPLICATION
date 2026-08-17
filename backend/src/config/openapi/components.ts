import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Register the `.openapi()` method on every Zod schema. Must run before any
// schema is introspected by the generator — importing this module guarantees it.
extendZodWithOpenApi(z);

/**
 * Registers the shared security scheme + reusable response schemas on the
 * registry and returns references to them so each per-domain path module can
 * compose its responses. Call once, before registering any path.
 */
export const registerComponents = (registry: OpenAPIRegistry) => {
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
      username: z.string().nullable(),
      displayName: z.string().nullable(),
      avatarUrl: z.string().url().nullable(),
      bio: z.string().nullable(),
      isOnline: z.boolean(),
      createdAt: z.string().datetime(),
    }),
  );

  const AccountState = registry.register('AccountState', z.enum(['ACTIVE', 'PENDING_DELETION']));
  const SessionScope = registry.register('SessionScope', z.enum(['active', 'account_recovery']));

  const AuthUser = registry.register(
    'AuthUser',
    z
      .object({
        id: z.string(),
        username: z.string(),
        email: z.string().email().nullable().optional(),
        phoneNumber: z.string().nullable().optional(),
        displayName: z.string().nullable(),
        avatarUrl: z.string().url().nullable(),
        bio: z.string().nullable(),
        accountState: AccountState,
        deletedAt: z.string().datetime().nullable(),
        permanentDeletionAt: z.string().datetime().nullable(),
      })
      .passthrough(),
  );

  const SessionCredentials = registry.register(
    'SessionCredentials',
    z.object({
      accessToken: z.string(),
      refreshToken: z.string(),
      scope: SessionScope,
    }),
  );

  const AuthSession = registry.register(
    'AuthSession',
    SessionCredentials.extend({ expiresAt: z.string().datetime() }),
  );

  const TokenPair = registry.register('TokenPair', SessionCredentials.extend({ user: AuthUser }));

  return {
    ErrorBody,
    SuccessVoid,
    UserPublic,
    AccountState,
    SessionScope,
    AuthUser,
    SessionCredentials,
    AuthSession,
    TokenPair,
  };
};

export type OpenApiComponents = ReturnType<typeof registerComponents>;
