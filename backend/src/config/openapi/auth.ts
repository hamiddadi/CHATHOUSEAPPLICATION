import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
} from '../../modules/auth/auth.schema';
import { sendOtpSchema, verifyOtpSchema } from '../../modules/otp/otp.schema';
import { legalAcceptanceSchema } from '../../modules/auth/legal-acceptance';
import type { OpenApiComponents } from './components';

export const registerAuthPaths = (
  registry: OpenAPIRegistry,
  {
    ErrorBody,
    SuccessVoid,
    AuthUser,
    AuthSession,
    SessionCredentials,
    TokenPair,
  }: OpenApiComponents,
): void => {
  // The runtime service enforces this in every non-test environment. Keep the
  // public contract strict even though integration tests may omit the flag.
  const requiredLegalAcceptance = {
    termsAccepted: z.literal(true),
    privacyNoticeAcknowledged: z.literal(true),
    legalDocumentVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    legalLocale: z.string().min(2).max(16),
  } as const;
  const publicRegisterSchema = registerSchema.extend({
    ageConfirmed: z.literal(true),
    ...requiredLegalAcceptance,
  });
  const LegacyAuthUnavailable = z.object({
    success: z.literal(false),
    error: z.object({
      code: z.literal('AUTH_009'),
      message: z.string(),
    }),
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/register',
    tags: ['Auth'],
    summary: 'Legacy email/password registration (non-production only)',
    description:
      'Retained for deliberate local and test fixtures. This operation is always unavailable in production and is also unavailable when LEGACY_EMAIL_AUTH_ENABLED=false; use phone + OTP instead.',
    deprecated: true,
    request: { body: { content: { 'application/json': { schema: publicRegisterSchema } } } },
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
      404: {
        description:
          'AUTH_009 — legacy email/password authentication is unavailable, including every production deployment.',
        content: { 'application/json': { schema: LegacyAuthUnavailable } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/login',
    tags: ['Auth'],
    summary: 'Legacy email/password login (non-production only)',
    description:
      'Retained for deliberate local and test fixtures. This operation is always unavailable in production and is also unavailable when LEGACY_EMAIL_AUTH_ENABLED=false; use phone + OTP instead.',
    deprecated: true,
    request: { body: { content: { 'application/json': { schema: loginSchema } } } },
    responses: {
      200: {
        description:
          'Credentials proven. Active accounts receive an active pair; self-deleted accounts still inside the grace period receive an account_recovery pair without being restored.',
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
      404: {
        description:
          'AUTH_009 — legacy email/password authentication is unavailable, including every production deployment.',
        content: { 'application/json': { schema: LegacyAuthUnavailable } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/send-otp',
    tags: ['Auth'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: sendOtpSchema.extend({
              ageConfirmed: z.literal(true),
              ...requiredLegalAcceptance,
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'OTP accepted for delivery without disclosing account existence.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: z.object({ sent: z.boolean() }).passthrough(),
            }),
          },
        },
      },
      403: {
        description: 'Age confirmation missing',
        content: { 'application/json': { schema: ErrorBody } },
      },
      429: {
        description: 'Rate limited',
        content: { 'application/json': { schema: ErrorBody } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/verify-otp',
    tags: ['Auth'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: verifyOtpSchema.extend({
              ageConfirmed: z.literal(true),
              ...requiredLegalAcceptance,
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description:
          'OTP verified. A pending-deletion account receives a recovery-only session and is not restored implicitly.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: z.object({
                session: AuthSession,
                user: AuthUser,
                isNewUser: z.boolean(),
              }),
            }),
          },
        },
      },
      401: {
        description: 'Invalid or expired OTP',
        content: { 'application/json': { schema: ErrorBody } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/legal-acceptance',
    tags: ['Auth'],
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        content: {
          'application/json': {
            schema: legalAcceptanceSchema.extend(requiredLegalAcceptance),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Current Terms acceptance and distinct Privacy Notice acknowledgement saved.',
        content: { 'application/json': { schema: SuccessVoid } },
      },
      403: {
        description: 'Explicit acceptance/acknowledgement missing',
        content: { 'application/json': { schema: ErrorBody } },
      },
      409: {
        description: 'Submitted version is not current',
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
        description:
          'Rotated token pair. Recovery sessions remain recovery-scoped and cannot be upgraded through refresh.',
        content: {
          'application/json': {
            schema: z.object({
              success: z.literal(true),
              data: SessionCredentials,
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
        description: 'Access token blacklisted. Active and recovery-only sessions may sign out.',
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
