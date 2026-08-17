import { i18n } from '../../core/i18n';
import { formatDate, formatDateTime, formatTime, formatWeekdayDate } from './intl';

describe('locale-safe date and time formatting', () => {
  const localIso = '2026-07-02T10:30:00';

  afterAll(async () => {
    await i18n.changeLanguage('fr');
  });

  it('uses the application language for chat times', async () => {
    await i18n.changeLanguage('fr');
    expect(formatTime(localIso)).toMatch(/10:30/);

    await i18n.changeLanguage('en');
    expect(formatTime(localIso)).toMatch(/10:30\s*AM/i);
  });

  it('formats long message-day labels without relying on the device locale', async () => {
    await i18n.changeLanguage('en');
    expect(formatWeekdayDate(localIso).toLowerCase()).toContain('thu');

    await i18n.changeLanguage('fr');
    expect(formatWeekdayDate(localIso).toLowerCase()).toContain('jeu');
  });

  it.each([formatDate, formatDateTime, formatTime, formatWeekdayDate])(
    'returns a safe placeholder for invalid input',
    formatter => {
      expect(formatter('not-a-date')).toBe('—');
      expect(formatter(null)).toBe('—');
    },
  );
});
