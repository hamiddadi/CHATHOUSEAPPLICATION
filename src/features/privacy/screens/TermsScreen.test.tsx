import React from 'react';
import { renderScreen, screen } from '../../../test-utils/renderScreen';
import { i18n } from '../../../core/i18n';
import { TermsScreen } from './TermsScreen';

describe('TermsScreen', () => {
  it('renders the terms title from i18n', () => {
    renderScreen(<TermsScreen />);
    expect(screen.getByText(i18n.t('privacy.terms.title'))).toBeTruthy();
  });

  it('renders all eight section headings', () => {
    renderScreen(<TermsScreen />);
    for (let s = 1; s <= 8; s++) {
      expect(screen.getByText(i18n.t(`privacy.terms.s${s}.title`))).toBeTruthy();
    }
  });
});
