/**
 * Cross-tier application constants. Importable from both frontend and
 * backend. Keeps numeric magic numbers in one place.
 */

export const APP = {
  MAX_ROOM_LISTENERS: 5_000,
  MAX_ROOM_SPEAKERS: 50,
  MAX_BIO_CHARS: 150,
  MAX_ROOM_TITLE_CHARS: 60,
  MIN_INTERESTS: 3,
  MAX_INTERESTS: 50,
  OTP_DIGITS: 4,
  OTP_TTL_MINUTES: 10,
  OTP_MAX_ATTEMPTS: 5,
  ACCOUNT_DELETION_GRACE_DAYS: 30,
  REMINDER_LEAD_MINUTES: [15, 5] as const,
  CHAT_MAX_CHARS: 500,
} as const;
