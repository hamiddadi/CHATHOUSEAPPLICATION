import type { ErrorEvent } from '@sentry/node';
import { sanitizeSentryEvent } from '../src/monitoring/sentry';
import { REDACTED_URL_CAPABILITY, sanitizeRequestUrl } from '../src/utils/sanitizeRequestUrl';

describe('sanitizeRequestUrl', () => {
  it('redacts the stable private-media capability and removes its query string', () => {
    const signature = 'a'.repeat(43);

    expect(sanitizeRequestUrl(`/media/media-1/${signature}?download=true`)).toBe(
      `/media/media-1/${REDACTED_URL_CAPABILITY}`,
    );
  });

  it('redacts the expiring capability in an absolute URL while preserving its expiry', () => {
    const signature = 'b'.repeat(43);

    expect(
      sanitizeRequestUrl(
        `https://api.chathouse.test/media/media-2/1786387200/${signature}?source=export#clip`,
      ),
    ).toBe(`https://api.chathouse.test/media/media-2/1786387200/${REDACTED_URL_CAPABILITY}`);
  });

  it('removes query data from ordinary API URLs without rewriting their path', () => {
    expect(sanitizeRequestUrl('/api/search?q=private+medical+topic&type=all')).toBe('/api/search');
    expect(sanitizeRequestUrl(undefined)).toBe('');
  });
});

describe('sanitizeSentryEvent', () => {
  it('sanitizes request and breadcrumb URLs in addition to default PII fields', () => {
    const stableSignature = 'c'.repeat(43);
    const expiringSignature = 'd'.repeat(43);
    const event: ErrorEvent = {
      type: undefined,
      user: { id: 'private-user' },
      request: {
        url: `https://api.test/media/media-3/${stableSignature}?token=query-secret`,
        query_string: 'token=query-secret',
        headers: { authorization: 'Bearer secret' },
        cookies: { session: 'secret' },
        data: { private: true },
      },
      breadcrumbs: [
        {
          data: {
            url: `/media/media-4/1786387200/${expiringSignature}?download=secret`,
            headers: { authorization: 'Bearer secret' },
            request_body: 'private body',
          },
        },
        { data: { url: '/api/search?q=sensitive' } },
      ],
    };

    const sanitized = sanitizeSentryEvent(event);

    expect(sanitized.user).toBeUndefined();
    expect(sanitized.request).toEqual({
      url: `https://api.test/media/media-3/${REDACTED_URL_CAPABILITY}`,
      query_string: undefined,
      headers: undefined,
      cookies: undefined,
      data: undefined,
    });
    expect(sanitized.breadcrumbs?.[0]?.data).toEqual({
      url: `/media/media-4/1786387200/${REDACTED_URL_CAPABILITY}`,
    });
    expect(sanitized.breadcrumbs?.[1]?.data?.['url']).toBe('/api/search');
    expect(JSON.stringify(sanitized)).not.toContain(stableSignature);
    expect(JSON.stringify(sanitized)).not.toContain(expiringSignature);
    expect(JSON.stringify(sanitized)).not.toContain('query-secret');
  });
});
