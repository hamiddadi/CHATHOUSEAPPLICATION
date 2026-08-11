import type { ErrorRequestHandler, Request, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { TokenExpiredError, JsonWebTokenError } from 'jsonwebtoken';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { sendError } from '../utils/response';
import { Sentry } from '../monitoring/sentry';
import { sanitizeRequestUrl } from '../utils/sanitizeRequestUrl';

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

  LIVEKIT_001: {
    status: 503,
    message: 'LiveKit is not configured on this server',
  },

  ROOM_001: { status: 404, message: 'Room not found' },
  ROOM_002: { status: 403, message: 'Room is full' },
  ROOM_003: { status: 403, message: 'Not a host' },
  ROOM_004: { status: 410, message: 'Room has ended' },
  ROOM_005: { status: 403, message: 'Not a room participant' },
  ROOM_006: { status: 403, message: 'Chat is disabled for this room' },
  ROOM_007: { status: 403, message: 'Private room — invitation required' },
  ROOM_008: { status: 403, message: 'You are banned from this room' },
  ROOM_009: { status: 400, message: 'Cannot mute the host' },
  ROOM_010: { status: 403, message: 'Room is locked' },
  ROOM_011: { status: 403, message: 'Room recording is disabled' },
  ROOM_012: {
    status: 409,
    message: 'Leave the current room before joining another',
  },
  ROOM_013: { status: 409, message: 'Scheduled event changed concurrently' },
  PREMIUM_001: { status: 403, message: 'Premium required' },

  USER_001: { status: 404, message: 'User not found' },
  USER_002: { status: 409, message: 'Username already taken' },
  USER_003: { status: 403, message: 'Cannot follow yourself' },
  USER_004: { status: 403, message: 'Cannot block yourself' },
  USER_005: { status: 429, message: 'Wave already sent recently' },
  USER_006: { status: 403, message: 'User does not accept waves' },

  MAPS_001: {
    status: 403,
    message: 'Map visibility must be enabled before sharing location',
  },
  UPLOAD_001: { status: 413, message: 'Uploaded media is too large' },
  PUSH_001: {
    status: 409,
    message: 'This push token is already bound to another account',
  },
  IDEMPOTENCY_001: {
    status: 409,
    message: 'Idempotency key was already used for a different request',
  },
  IDEMPOTENCY_002: { status: 400, message: 'Invalid Idempotency-Key header' },

  CHAT_001: { status: 404, message: 'Conversation not found' },
  CHAT_002: { status: 404, message: 'Message not found' },
  CHAT_003: { status: 403, message: 'Not your message' },
  CHAT_004: {
    status: 403,
    message: 'This recipient cannot receive a direct message from you right now',
  },

  GROUP_001: { status: 404, message: 'Group conversation not found' },
  GROUP_002: { status: 403, message: 'Not a member of this group' },
  GROUP_003: {
    status: 400,
    message: 'A group needs at least two other members',
  },
  GROUP_004: { status: 403, message: 'Only the group owner can do that' },
  GROUP_005: { status: 400, message: 'Use leave to remove yourself' },
  GROUP_006: {
    status: 403,
    message: 'Blocked: cannot share a group with this user',
  },
  GROUP_007: {
    status: 403,
    message: 'An accepted follow is required to add this user',
  },
  GROUP_008: { status: 400, message: 'Group member limit reached' },

  REPORT_001: { status: 403, message: 'You cannot report your own content' },
  REPORT_002: { status: 404, message: 'Reportable content not found' },

  CLUB_001: { status: 404, message: 'Club not found' },
  CLUB_002: { status: 403, message: 'Not a club admin' },
  CLUB_003: { status: 403, message: 'Private club — join forbidden' },
  CLUB_004: { status: 409, message: 'Already a member' },
  CLUB_005: { status: 403, message: 'Owner cannot leave their own club' },
  CLUB_006: { status: 403, message: 'Club creation limit reached' },
  CLUB_007: {
    status: 403,
    message: 'A valid invitation is required to join this club',
  },
  CLUB_008: { status: 410, message: 'This invitation link has expired' },
  CLUB_009: { status: 403, message: 'This invitation link is invalid' },

  ACCOUNT_001: {
    status: 409,
    message: 'Account already scheduled for deletion',
  },
  AGE_001: {
    status: 403,
    message: 'You must confirm that you are at least 16 years old',
  },
  LEGAL_001: {
    status: 403,
    message: 'You must accept the current Terms and acknowledge the Privacy Notice',
  },
  LEGAL_002: {
    status: 409,
    message: 'The legal documents have changed; review the current version',
  },

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

const describe = (
  err: unknown,
): { code: string; message: string; status: number; details?: unknown } => {
  if (err instanceof AppError) {
    return {
      code: err.code,
      message: err.message,
      status: err.status,
      details: err.details,
    };
  }
  if (err instanceof ZodError) {
    return {
      code: 'VALIDATION_001',
      message: ERROR_CODES.VALIDATION_001.message,
      status: ERROR_CODES.VALIDATION_001.status,
      details: err.flatten().fieldErrors,
    };
  }
  if (err instanceof TokenExpiredError) {
    return {
      code: 'AUTH_002',
      message: ERROR_CODES.AUTH_002.message,
      status: ERROR_CODES.AUTH_002.status,
    };
  }
  if (err instanceof JsonWebTokenError) {
    return {
      code: 'AUTH_003',
      message: ERROR_CODES.AUTH_003.message,
      status: ERROR_CODES.AUTH_003.status,
    };
  }
  if (
    typeof err === 'object' &&
    err !== null &&
    ('status' in err || 'type' in err) &&
    (Reflect.get(err, 'status') === 413 || Reflect.get(err, 'type') === 'entity.too.large')
  ) {
    return {
      code: 'UPLOAD_001',
      message: ERROR_CODES.UPLOAD_001.message,
      status: ERROR_CODES.UPLOAD_001.status,
    };
  }
  // Extension modules intentionally use a separate error registry. Accept
  // their documented wire contract via strict duck typing, while constraining
  // status to the HTTP error range so arbitrary thrown objects cannot turn an
  // exception into a successful response.
  if (typeof err === 'object' && err !== null) {
    const code = Reflect.get(err, 'code');
    const status = Reflect.get(err, 'status');
    const message = Reflect.get(err, 'message');
    const details = Reflect.get(err, 'details');
    if (
      typeof code === 'string' &&
      /^[A-Z][A-Z0-9_]*$/.test(code) &&
      typeof status === 'number' &&
      Number.isInteger(status) &&
      status >= 400 &&
      status <= 599 &&
      typeof message === 'string'
    ) {
      return {
        code,
        message,
        status,
        ...(details !== undefined ? { details } : {}),
      };
    }
  }
  return {
    code: 'SERVER_001',
    message: ERROR_CODES.SERVER_001.message,
    status: ERROR_CODES.SERVER_001.status,
  };
};

export const errorMiddleware: ErrorRequestHandler = (err, req: Request, res, next) => {
  const { code, message, status, details } = describe(err);

  logger.error(`${req.method} ${sanitizeRequestUrl(req.originalUrl)} → ${code} ${status}`, {
    err: err instanceof Error ? err.message : err,
    stack: err instanceof Error && env.NODE_ENV !== 'production' ? err.stack : undefined,
    details,
  });

  // Report unexpected server-side failures (5xx) to Sentry. 4xx are client
  // errors (validation, auth, not-found) and are intentionally not captured to
  // keep the issue stream signal-rich. No-op when SENTRY_DSN is unset.
  if (status >= 500) {
    Sentry.captureException(err);
  }

  // A streamed response may fail after its status and headers are already on
  // the wire. Delegate to Express' final handler so the socket is terminated;
  // attempting to send our JSON envelope here would raise ERR_HTTP_HEADERS_SENT.
  if (res.headersSent) {
    next(err);
    return;
  }

  sendError(res, code, message, status, env.NODE_ENV === 'production' ? undefined : details);
};
