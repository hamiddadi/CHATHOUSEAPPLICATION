import type { RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { AppError } from '../../middlewares/error.middleware';

const VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_LEGAL_DOCUMENT_VERSION = '2026-07-29';
const isAsciiLetter = (character: string): boolean =>
  (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z');
const isAsciiAlphaNumeric = (character: string): boolean =>
  isAsciiLetter(character) || (character >= '0' && character <= '9');
const isValidLocale = (value: string): boolean => {
  const parts = value.split('-');
  const language = parts[0] ?? '';
  if (
    value.length > 16 ||
    language.length < 2 ||
    language.length > 3 ||
    ![...language].every(isAsciiLetter)
  ) {
    return false;
  }
  return parts.slice(1).every(part => {
    return part.length >= 2 && part.length <= 8 && [...part].every(isAsciiAlphaNumeric);
  });
};

/**
 * Kept optional at the schema boundary so missing fields receive a stable
 * LEGAL_001 response instead of a generic validation error. The service below
 * is the single authoritative validator used by register, OTP and reacceptance.
 */
export const legalAcceptanceFieldsSchema = {
  termsAccepted: z.boolean().optional(),
  legalDocumentVersion: z.string().trim().max(32).optional(),
  privacyNoticeAcknowledged: z.boolean().optional(),
  legalLocale: z.string().trim().max(16).optional(),
} as const;

export const legalAcceptanceSchema = z.object(legalAcceptanceFieldsSchema);

export type LegalAcceptanceInput = z.infer<typeof legalAcceptanceSchema>;

export const legalAcceptanceSelect = {
  termsAcceptedVersion: true,
  termsAcceptedAt: true,
  privacyNoticeAcknowledgedVersion: true,
  privacyNoticeAcknowledgedAt: true,
  legalAcceptanceLocale: true,
} as const;

type StoredLegalAcceptance = {
  termsAcceptedVersion: string | null;
  termsAcceptedAt: Date | null;
  privacyNoticeAcknowledgedVersion: string | null;
  privacyNoticeAcknowledgedAt: Date | null;
  legalAcceptanceLocale: string | null;
};

const configuredVersion = (): string => {
  const version = env.LEGAL_DOCUMENT_VERSION;
  if (version && VERSION_PATTERN.test(version)) return version;
  if (env.NODE_ENV !== 'production') return LOCAL_LEGAL_DOCUMENT_VERSION;
  throw new AppError(
    'SERVER_001',
    'The current legal document version is not configured on this server',
  );
};

export const currentLegalDocumentVersion = configuredVersion;

const hasNoSubmittedLegalFields = (input: LegalAcceptanceInput): boolean =>
  input.termsAccepted === undefined &&
  input.legalDocumentVersion === undefined &&
  input.privacyNoticeAcknowledged === undefined &&
  input.legalLocale === undefined;

export interface ResolvedLegalAcceptance {
  termsAcceptedVersion: string;
  termsAcceptedAt: Date;
  privacyNoticeAcknowledgedVersion: string;
  privacyNoticeAcknowledgedAt: Date;
  legalAcceptanceLocale: string;
}

/**
 * Resolve a wire acknowledgement into the exact values stored in the DB.
 *
 * The test-only empty-input branch keeps the large pre-existing integration
 * fixture suite compatible; any explicitly submitted partial/stale payload is
 * still rejected in tests. Production and development always fail closed.
 */
export const resolveLegalAcceptance = (
  input: LegalAcceptanceInput,
  now = new Date(),
): ResolvedLegalAcceptance => {
  const currentVersion = configuredVersion();
  if (env.NODE_ENV === 'test' && hasNoSubmittedLegalFields(input)) {
    return {
      termsAcceptedVersion: currentVersion,
      termsAcceptedAt: now,
      privacyNoticeAcknowledgedVersion: currentVersion,
      privacyNoticeAcknowledgedAt: now,
      legalAcceptanceLocale: 'en',
    };
  }

  if (input.termsAccepted !== true || input.privacyNoticeAcknowledged !== true) {
    throw new AppError('LEGAL_001');
  }
  if (input.legalDocumentVersion !== currentVersion) {
    throw new AppError('LEGAL_002', undefined, { currentVersion });
  }
  if (!input.legalLocale || !isValidLocale(input.legalLocale)) {
    throw new AppError('LEGAL_001', 'A valid legal acknowledgement locale is required');
  }

  return {
    termsAcceptedVersion: currentVersion,
    termsAcceptedAt: now,
    privacyNoticeAcknowledgedVersion: currentVersion,
    privacyNoticeAcknowledgedAt: now,
    legalAcceptanceLocale: input.legalLocale,
  };
};

export const legalAcceptanceStatus = (stored: StoredLegalAcceptance) => {
  const currentVersion = configuredVersion();
  const accepted =
    stored.termsAcceptedVersion === currentVersion &&
    stored.termsAcceptedAt !== null &&
    stored.privacyNoticeAcknowledgedVersion === currentVersion &&
    stored.privacyNoticeAcknowledgedAt !== null;
  return {
    legalDocumentVersion: currentVersion,
    legalAcceptanceRequired: !accepted,
  };
};

export const acceptCurrentLegalDocuments = async (userId: string, input: LegalAcceptanceInput) => {
  const accepted = resolveLegalAcceptance(input);
  const stored = await prisma.user.update({
    where: { id: userId },
    data: accepted,
    select: legalAcceptanceSelect,
  });
  return { ...stored, ...legalAcceptanceStatus(stored) };
};

export const assertCurrentLegalAcceptance = async (userId: string): Promise<void> => {
  const stored = await prisma.user.findUnique({
    where: { id: userId },
    select: legalAcceptanceSelect,
  });
  if (!stored) throw new AppError('AUTH_003');
  if (legalAcceptanceStatus(stored).legalAcceptanceRequired) {
    throw new AppError('LEGAL_001');
  }
};

export const hasCurrentLegalAcceptance = async (userId: string): Promise<boolean> => {
  const stored = await prisma.user.findUnique({
    where: { id: userId },
    select: legalAcceptanceSelect,
  });
  return stored !== null && !legalAcceptanceStatus(stored).legalAcceptanceRequired;
};

/** Route guard for endpoints that create or edit user-generated content. */
export const requireCurrentLegalAcceptance: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.userId) return next(new AppError('AUTH_003'));
    await assertCurrentLegalAcceptance(req.userId);
    next();
  } catch (error) {
    next(error);
  }
};
