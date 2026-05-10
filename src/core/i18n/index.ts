// eslint-disable-next-line import/no-named-as-default
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import en from './locales/en.json';
import fr from './locales/fr.json';

/**
 * Detects the device locale at boot and falls back to English. We keep the
 * locale list narrow on purpose — add one by dropping a JSON next to this
 * file and extending the `resources` map. Translations are loaded
 * synchronously from bundled JSON; no remote fetch so the app never blocks
 * on i18n and works offline out of the box.
 */
const deviceTag = getLocales()[0]?.languageCode ?? 'en';
const initialLng = deviceTag in { fr: 1, en: 1 } ? deviceTag : 'en';

/* eslint-disable-next-line import/no-named-as-default-member */
void i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
  },
  lng: initialLng,
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // RN is already XSS-safe
  returnNull: false,
  compatibilityJSON: 'v4',
});

export { i18next as i18n };
export { useTranslation } from 'react-i18next';
export type { TFunction } from 'i18next';
