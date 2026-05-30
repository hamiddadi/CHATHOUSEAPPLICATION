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
 * Whether the JS engine ships a *locale-aware* `Intl.DateTimeFormat`.
 * On React Native + Hermes, `Intl` may exist but ignore the `locale`
 * argument (Hermes built without full ICU and no polyfill), which would
 * render dates in the device locale — the exact bug this module avoids.
 * We probe once: a working build renders the same instant differently for
 * en-US vs fr-FR. If they match (or Intl throws / is absent), we fall back
 * to our own deterministic formatter instead of trusting `toLocale*`.
 *
 * NOTE: loading a polyfill (`import 'intl'`) belongs in the boot entry
 * (index.js), which is outside this file's scope.
 * // TODO(audit): load Intl polyfill at boot if full ICU is required.
 */
const intlIsLocaleAware = ((): boolean => {
  try {
    if (typeof Intl === 'undefined' || typeof Intl.DateTimeFormat !== 'function') return false;
    const probe = new Date(Date.UTC(2020, 0, 31, 13, 5));
    const en = new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(probe);
    const fr = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(probe);
    return en !== fr;
  } catch {
    return false;
  }
})();

/** Sentinel rendered for null/empty/invalid inputs. */
const EMPTY_PLACEHOLDER = '—';
const DATETIME_OPTS = { dateStyle: 'medium', timeStyle: 'short' } as const;
const DATE_OPTS = { dateStyle: 'medium' } as const;

/** Parse an ISO string to a valid Date, or null for empty/invalid input. */
const parseIso = (iso?: string | null): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

// Deterministic, Intl-free fallbacks. Format mirrors common FR/EN ordering
// (fr/system default: DD/MM/YYYY; en: MM/DD/YYYY) so output is stable across
// engines regardless of ICU availability.
const fallbackDate = (date: Date, locale: string): string => {
  const d = pad2(date.getDate());
  const m = pad2(date.getMonth() + 1);
  const y = date.getFullYear();
  return locale.startsWith('en') ? `${m}/${d}/${y}` : `${d}/${m}/${y}`;
};

const fallbackDateTime = (date: Date, locale: string): string =>
  `${fallbackDate(date, locale)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

/**
 * Format an ISO timestamp as a locale-aware "date + time" string —
 * always honours the UI language, regardless of the device locale.
 * Returns '—' for null/empty inputs so it can be embedded directly in
 * JSX without a guard.
 */
export const formatDateTime = (iso: string | null | undefined): string => {
  const date = parseIso(iso);
  if (!date) return EMPTY_PLACEHOLDER;
  const locale = resolveLocale();
  if (!intlIsLocaleAware) return fallbackDateTime(date, locale);
  // Freeze the options so the rendering is stable across engines/versions.
  return new Intl.DateTimeFormat(locale, DATETIME_OPTS).format(date);
};

/**
 * Date-only variant. Same null-safety contract as `formatDateTime`.
 */
export const formatDate = (iso: string | null | undefined): string => {
  const date = parseIso(iso);
  if (!date) return EMPTY_PLACEHOLDER;
  const locale = resolveLocale();
  if (!intlIsLocaleAware) return fallbackDate(date, locale);
  return new Intl.DateTimeFormat(locale, DATE_OPTS).format(date);
};
