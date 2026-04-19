import { z, type ZodSchema } from 'zod';

/** Opaque ID — non-empty string, trimmed. */
export const idSchema = z.string().trim().min(1, 'id is required').max(64);

/** Parse-or-throw helper for deep-link params. Returns the validated value, throws a typed error otherwise. */
export const parseRouteParams = <T>(schema: ZodSchema<T>, params: unknown, context: string): T => {
  const result = schema.safeParse(params);
  if (result.success) return result.data;
  throw new RouteParamValidationError(context, result.error.issues.map(i => i.message).join(', '));
};

/** Soft variant — returns null when the input doesn't match, lets screens render a fallback UI. */
export const safeParseRouteParams = <T>(schema: ZodSchema<T>, params: unknown): T | null => {
  const result = schema.safeParse(params);
  return result.success ? result.data : null;
};

export class RouteParamValidationError extends Error {
  constructor(
    public readonly route: string,
    public readonly detail: string,
  ) {
    super(`Invalid params for route "${route}": ${detail}`);
    this.name = 'RouteParamValidationError';
  }
}

/* ============================================================
 * Shared schemas — one per route that takes dynamic params.
 * Screens import these instead of redeclaring shapes.
 * ========================================================== */
export const roomIdParams = z.object({ roomId: idSchema });
export const houseIdParams = z.object({ houseId: idSchema });
export const userIdParams = z.object({ userId: idSchema });
export const conversationIdParams = z.object({ conversationId: idSchema });

export const houseInvitationParams = z.object({
  houseId: idSchema,
  inviteToken: z.string().trim().min(1).optional(),
});

export const followersParams = z.object({
  userId: idSchema,
  initialTab: z.enum(['followers', 'following']).optional(),
});

export const otpParams = z.object({
  phoneNumber: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s\-()]{6,20}$/, 'Invalid phone number'),
});
