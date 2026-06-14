/**
 * Render-test for TermsScreen. Static legal document (no route params, no
 * queries, no buttons). Asserts it mounts and renders its real translated
 * heading and representative section titles.
 */
import React from 'react';
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
    expect(getByText('Last updated: April 25, 2026')).toBeTruthy();
  });

  it('renders the numbered section headers (1..8)', () => {
    const { getByText } = renderScreen(<TermsScreen />);
    expect(getByText('1. Acceptance')).toBeTruthy();
    expect(getByText('3. Prohibited Conduct')).toBeTruthy();
    expect(getByText('8. Governing Law')).toBeTruthy();
  });
});
