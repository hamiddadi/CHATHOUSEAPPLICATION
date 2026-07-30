import { legalUrls, localizedLegalUrl } from './legalUrls';

describe('localizedLegalUrl', () => {
  it('keeps English and unknown languages on the canonical URL', () => {
    expect(localizedLegalUrl(legalUrls.privacy, 'en-US')).toBe(legalUrls.privacy);
    expect(localizedLegalUrl(legalUrls.privacy, undefined)).toBe(legalUrls.privacy);
  });

  it('selects the explicit French legal page without changing the path', () => {
    const localized = new URL(localizedLegalUrl(legalUrls.terms, 'fr-FR'));

    expect(localized.pathname).toBe('/terms');
    expect(localized.searchParams.get('lang')).toBe('fr');
  });
});
