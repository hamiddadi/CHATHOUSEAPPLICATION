import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { mockAuthenticated, resetAuth } from '../../../test-utils/renderScreen';
import { useAuthStore } from '../../auth/store/authStore';
import { LegalAcceptanceGate } from './LegalAcceptanceGate';

describe('LegalAcceptanceGate', () => {
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('requires both distinct acknowledgements before saving the current version', async () => {
    const acceptLegalDocuments = jest.fn().mockResolvedValue(undefined);
    mockAuthenticated({ legalAcceptanceRequired: true });
    useAuthStore.setState({ acceptLegalDocuments });

    const { getByLabelText, getByTestId } = render(<LegalAcceptanceGate />);
    const submit = getByTestId('legal-gate-submit');
    expect(submit).toBe(getByLabelText('Accept and continue'));
    expect(submit.props.accessibilityState.disabled).toBe(true);

    fireEvent.press(getByTestId('legal-gate-terms-checkbox'));
    expect(submit.props.accessibilityState.disabled).toBe(true);
    fireEvent.press(getByTestId('legal-gate-privacy-checkbox'));
    fireEvent.press(submit);

    await waitFor(() => {
      expect(acceptLegalDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          termsAccepted: true,
          privacyNoticeAcknowledged: true,
          legalDocumentVersion: '2026-07-29',
        }),
      );
    });
  });

  it('stays hidden when the stored acceptance is current', () => {
    mockAuthenticated({ legalAcceptanceRequired: false });
    const { queryByTestId } = render(<LegalAcceptanceGate />);
    expect(queryByTestId('legal-acceptance-gate')).toBeNull();
  });
});
