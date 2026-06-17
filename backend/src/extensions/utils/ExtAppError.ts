/**
 * Extension-scoped error class. Mirrors AppError's wire format
 * (`{ code, message, status }`) without modifying the existing error
 * registry. Caught by the existing errorMiddleware via duck-typing on the
 * `status` and `code` fields.
 */
export class ExtAppError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(code: string, message?: string, status = 400, details?: unknown) {
    super(message ?? code);
    this.name = 'ExtAppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const EXT_ERROR = {
  PAY_NOT_CONFIGURED: { status: 503, message: 'Payments are not configured' },
  PAY_INVALID: { status: 400, message: 'Invalid payment request' },
  PAY_RECIPIENT_NOT_CONFIGURED: { status: 412, message: 'Recipient has not configured payouts' },
  PAY_KYC_INCOMPLETE: { status: 412, message: 'Recipient KYC is not complete' },
  PAY_CURRENCY_UNSUPPORTED: { status: 400, message: 'Currency not supported' },
  PAY_RETURN_URL_MISSING: { status: 503, message: 'Payment return URLs are not configured' },
  PAY_WEBHOOK_INVALID: { status: 400, message: 'Invalid webhook signature' },
  PREMIUM_NOT_CONFIGURED: { status: 503, message: 'Premium is not configured' },
  PREMIUM_REQUIRED: { status: 402, message: 'This feature requires ChatHouse Premium' },
  PREMIUM_NO_SUBSCRIPTION: { status: 404, message: 'No active subscription found' },
  CLUB_REQ_DUPLICATE: { status: 409, message: 'Already a member or pending' },
  CLUB_REQ_NOT_FOUND: { status: 404, message: 'Join request not found' },
  // Twitter/X OAuth import (server-side PKCE).
  TWITTER_NOT_CONFIGURED: { status: 503, message: 'Twitter OAuth is not configured' },
  TWITTER_STATE_INVALID: { status: 400, message: 'OAuth state expired or invalid' },
  TWITTER_OAUTH_FAILED: { status: 502, message: 'Twitter OAuth exchange failed' },
  // ANO-13: dedicated speak-invite error codes (previously borrowed PAY_/CLUB_REQ_ codes).
  SPEAK_001: { status: 403, message: 'Only host or moderator can manage speak invites' },
  SPEAK_002: { status: 404, message: 'No active speak invite' },
} as const;

export const extError = (key: keyof typeof EXT_ERROR, customMessage?: string): ExtAppError => {
  const def = EXT_ERROR[key];
  return new ExtAppError(key, customMessage ?? def.message, def.status);
};
