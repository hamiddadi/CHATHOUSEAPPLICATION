import { legalDocumentVersion } from '../../config/env';

export type ConsentPurpose = 'diagnostics' | 'location';
export type ConsentStatus = 'granted' | 'denied';

export interface VersionedConsentRecord {
  schemaVersion: 1;
  purpose: ConsentPurpose;
  status: ConsentStatus;
  documentVersion: string;
  recordedAt: string;
}

export const createConsentRecord = (
  purpose: ConsentPurpose,
  status: ConsentStatus,
  now = new Date(),
): VersionedConsentRecord => ({
  schemaVersion: 1,
  purpose,
  status,
  documentVersion: legalDocumentVersion,
  recordedAt: now.toISOString(),
});

/**
 * Consent is purpose-specific and tied to the current legal copy. Legacy
 * booleans, malformed storage and records from an older document version all
 * fail closed so a changed notice is shown and accepted again.
 */
export const parseCurrentConsentRecord = (
  raw: string | null,
  expectedPurpose: ConsentPurpose,
): VersionedConsentRecord | null => {
  if (!raw) return null;

  try {
    const candidate = JSON.parse(raw) as Partial<VersionedConsentRecord>;
    if (
      candidate.schemaVersion !== 1 ||
      candidate.purpose !== expectedPurpose ||
      (candidate.status !== 'granted' && candidate.status !== 'denied') ||
      candidate.documentVersion !== legalDocumentVersion ||
      typeof candidate.recordedAt !== 'string' ||
      Number.isNaN(Date.parse(candidate.recordedAt))
    ) {
      return null;
    }
    return candidate as VersionedConsentRecord;
  } catch {
    return null;
  }
};
