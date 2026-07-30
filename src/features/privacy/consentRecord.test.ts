import { legalDocumentVersion } from '../../config/env';
import { createConsentRecord, parseCurrentConsentRecord } from './consentRecord';

describe('versioned consent records', () => {
  it('creates a timestamped, purpose-specific record for the current notice', () => {
    const now = new Date('2026-07-29T12:34:56.000Z');
    expect(createConsentRecord('diagnostics', 'granted', now)).toEqual({
      schemaVersion: 1,
      purpose: 'diagnostics',
      status: 'granted',
      documentVersion: legalDocumentVersion,
      recordedAt: now.toISOString(),
    });
  });

  it('accepts only a valid record for the requested purpose and current version', () => {
    const record = createConsentRecord('location', 'granted');
    expect(parseCurrentConsentRecord(JSON.stringify(record), 'location')).toEqual(record);
    expect(parseCurrentConsentRecord(JSON.stringify(record), 'diagnostics')).toBeNull();
  });

  it('fails closed for legacy booleans, malformed data and stale legal copy', () => {
    expect(parseCurrentConsentRecord('1', 'diagnostics')).toBeNull();
    expect(parseCurrentConsentRecord('{broken', 'diagnostics')).toBeNull();
    expect(
      parseCurrentConsentRecord(
        JSON.stringify({
          ...createConsentRecord('diagnostics', 'granted'),
          documentVersion: '2025-01-01',
        }),
        'diagnostics',
      ),
    ).toBeNull();
  });
});
