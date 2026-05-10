import { i18n } from '../../core/i18n';

/**
 * Map our app's i18n language tag to a BCP-47 locale acceptable by
 * `Intl.DateTimeFormat`. Default to French if the tag is unrecognised —
 * Chathouse's primary audience is FR-speaking and the alternative
 * (Intl falls back to system locale) leads to dates rendered in
 * surprising languages on devices set to e.g. Japanese.
 */
const APP_TO_INTL_LOCALE: Record<string, string> = {
  fr: 'fr-FR',
  en: 'en-US',
};

const resolveLocale = (): string => {
  const tag = i18n.language?.split('-')[0] ?? 'fr';
  return APP_TO_INTL_LOCALE[tag] ?? 'fr-FR';
};

/**
 * Format an ISO timestamp as a locale-aware "date + time" string —
 * always honours the UI language, regardless of the device locale.
 * Returns '—' for null/empty inputs so it can be embedded directly in
 * JSX without a guard.
 */
export const formatDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(resolveLocale());
};

/**
 * Date-only variant. Same null-safety contract as `formatDateTime`.
 */
export const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(resolveLocale());
};
