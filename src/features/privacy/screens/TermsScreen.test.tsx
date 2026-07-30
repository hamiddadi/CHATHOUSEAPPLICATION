/**
 * Render-test for TermsScreen. Static legal document (no route params, no
 * queries). Asserts it mounts, renders its real translated content and keeps
 * an explicit navigation control available before authentication.
 */
import React from 'react';
import { Linking } from 'react-native';
import { fireEvent } from '@testing-library/react-native';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../test-utils/renderScreen';
import { TermsScreen } from './TermsScreen';

describe('TermsScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts and renders the terms title + last-updated line', () => {
    const { getByText, toJSON } = renderScreen(<TermsScreen />);
    expect(toJSON()).toBeTruthy();
    expect(getByText('Terms of Service')).toBeTruthy();
    expect(getByText('Document version: 2026-07-29')).toBeTruthy();
  });

  it('renders the numbered section headers (1..8)', () => {
    const { getByText } = renderScreen(<TermsScreen />);
    expect(getByText('1. Acceptance')).toBeTruthy();
    expect(getByText('3. Prohibited Conduct')).toBeTruthy();
    expect(getByText('8. Governing Law')).toBeTruthy();
  });

  it('opens the canonical complete Terms link', () => {
    const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    const { getByText } = renderScreen(<TermsScreen />);
    fireEvent.press(getByText('Read the complete terms'));
    expect(openSpy).toHaveBeenCalledWith(expect.stringMatching(/\/terms$/u));
  });

  it('renders the Eligibility rules paragraphs (s2.p2 / s2.p3) that were previously dropped', () => {
    // Regression: TermsScreen used to render only s2.p1, silently omitting the
    // two "important rules" paragraphs that exist in the locales.
    const { getByText } = renderScreen(<TermsScreen />);
    expect(
      getByText('• Do not share illegal, explicit, or copyright-infringing content.'),
    ).toBeTruthy();
    expect(
      getByText(
        '• Built-in room recording is disabled. Do not make an external recording without the explicit consent of everyone concerned.',
      ),
    ).toBeTruthy();
  });

  it('returns through the explicit legal-document back control', () => {
    const { navigation, getByTestId } = renderScreen(<TermsScreen />);
    fireEvent.press(getByTestId('terms-screen-back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
