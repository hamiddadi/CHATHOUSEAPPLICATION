import { env } from '../../config/env';

const apiOrigin = new URL(env.API_BASE_URL).origin;

export const legalUrls = {
  privacy: `${apiOrigin}/privacy`,
  terms: `${apiOrigin}/terms`,
} as const;

export const localizedLegalUrl = (url: string, language: string | undefined): string => {
  if (!language?.toLowerCase().startsWith('fr')) return url;
  const localized = new URL(url);
  localized.searchParams.set('lang', 'fr');
  return localized.toString();
};
