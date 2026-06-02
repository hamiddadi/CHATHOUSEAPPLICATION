import type { ErrorRequestHandler, Request, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { TokenExpiredError, JsonWebTokenError } from 'jsonwebtoken';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { sendError } from '../utils/response';

/**
 * Standardised error codes. Format: DOMAIN_NNN so clients can branch on a
 * stable key without parsing English messages.
 */
export const ERROR_CODES = {
  AUTH_001: { status: 401, message: 'Invalid credentials' },
  AUTH_002: { status: 401, message: 'Token expired' },
  AUTH_003: { status: 401, message: 'Unauthorized' },
  AUTH_004: { status: 401, message: 'Token revoked' },
  AUTH_005: { status: 409, message: 'Email already registered' },
  AUTH_006: { status: 409, message: 'Username already taken' },
  AUTH_007: { status: 403, message: 'Account suspended' },
  AUTH_008: { status: 403, message: 'Insufficient privileges' },
  ADMIN_001: { status: 403, message: 'Cannot demote the only super-admin' },
  ADMIN_002: { status: 403, message: 'Cannot modify a higher-ranked admin' },
  // 403 Forbidden — the surface exists but is administratively disabled.
  // 410 Gone implies permanent removal, which is wrong for a toggleable
  // kill-switch and misleads clients/proxies into caching the failure.
  ADMIN_003: { status: 403, message: 'Godmode is disabled' },

  LIVEKIT_001: { status: 503, message: 'LiveKit is not configured on this server' },

  ROOM_001: { status: 404, message: 'Room not found' },
  ROOM_002: { status: 403, message: 'Room is full' },
  ROOM_003: { status: 403, message: 'Not a host' },
  ROOM_004: { status: 410, message: 'Room has ended' },
  ROOM_005: { status: 403, message: 'Not a room participant' },
  ROOM_006: { status: 403, message: 'Chat is disabled for this room' },
  ROOM_007: { status: 403, message: 'Private room — invitation required' },
  ROOM_008: { status: 403, message: 'You are banned from this room' },
  ROOM_009: { status: 400, message: 'Cannot mute the host' },

  USER_001: { status: 404, message: 'User not found' },
  USER_002: { status: 409, message: 'Username already taken' },
  USER_003: { status: 403, message: 'Cannot follow yourself' },
  USER_004: { status: 403, message: 'Cannot block yourself' },
  USER_005: { status: 429, message: 'Wave already sent recently' },
  USER_006: { status: 403, message: 'User does not accept waves' },

  CHAT_001: { status: 404, message: 'Conversation not found' },
  CHAT_002: { status: 404, message: 'Message not found' },
  CHAT_003: { status: 403, message: 'Not your message' },
  CHAT_004: { status: 403, message: 'Direct messages are limited to mutual follows' },

  GROUP_001: { status: 404, message: 'Group conversation not found' },
  GROUP_002: { status: 403, message: 'Not a member of this group' },
  GROUP_003: { status: 400, message: 'A group needs at least two other members' },
  GROUP_004: { status: 403, message: 'Only the group owner can do that' },
  GROUP_005: { status: 400, message: 'Use leave to remove yourself' },

  CLUB_001: { status: 404, message: 'Club not found' },
  CLUB_002: { status: 403, message: 'Not a club admin' },
  CLUB_003: { status: 403, message: 'Private club — join forbidden' },
  CLUB_004: { status: 409, message: 'Already a member' },
  CLUB_005: { status: 403, message: 'Owner cannot leave their own club' },
  CLUB_006: { status: 403, message: 'Club creation limit reached' },
  CLUB_007: { status: 403, message: 'A valid invitation is required to join this club' },

  ACCOUNT_001: { status: 409, message: 'Account already scheduled for deletion' },

  VALIDATION_001: { status: 400, message: 'Invalid request payload' },
  RATE_LIMIT_001: { status: 429, message: 'Too many requests' },
  SERVER_001: { status: 500, message: 'Internal server error' },
  NOT_FOUND_001: { status: 404, message: 'Resource not found' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  public readonly status: number;

  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly details?: unknown,
  ) {
    const spec = ERROR_CODES[code];
    super(message ?? spec.message);
    this.status = spec.status;
    this.name = 'AppError';
  }
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError('NOT_FOUND_001'));
};

const describe = (err: unknown): { code: ErrorCode; message: string; details?: unknown } => {
  if (err instanceof AppError) {
    return { code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof ZodError) {
    return {
      code: 'VALIDATION_001',
      message: ERROR_CODES.VALIDATION_001.message,
      details: err.flatten().fieldErrors,
    };
  }
  if (err instanceof TokenExpiredError) {
    return { code: 'AUTH_002', message: ERROR_CODES.AUTH_002.message };
  }
  if (err instanceof JsonWebTokenError) {
    return { code: 'AUTH_003', message: ERROR_CODES.AUTH_003.message };
  }
  return { code: 'SERVER_001', message: ERROR_CODES.SERVER_001.message };
};

export const errorMiddleware: ErrorRequestHandler = (err, req: Request, res, _next) => {
  const { code, message, details } = describe(err);
  const status = ERROR_CODES[code].status;

  logger.error(`${req.method} ${req.originalUrl} → ${code} ${status}`, {
    err: err instanceof Error ? err.message : err,
    stack: err instanceof Error && env.NODE_ENV !== 'production' ? err.stack : undefined,
    details,
  });

  sendError(res, code, message, status, env.NODE_ENV === 'production' ? undefined : details);
};
