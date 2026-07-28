import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ExtPremiumRow } from './ExtPremiumRow';

const mockExternalPurchasesAllowed = jest.fn();
const mockUsePremiumStatus = jest.fn();
const mockCheckoutMutate = jest.fn();
const mockPortalMutate = jest.fn();

jest.mock('../utils/digitalPurchases', () => ({
  areExternalDigitalPurchasesAllowed: () => mockExternalPurchasesAllowed(),
}));

jest.mock('../hooks/usePremium', () => ({
  usePremiumStatus: (...args: unknown[]) => mockUsePremiumStatus(...args),
  useStartPremiumCheckout: () => ({
    mutate: mockCheckoutMutate,
    isPending: false,
  }),
  useOpenBillingPortal: () => ({
    mutate: mockPortalMutate,
    isPending: false,
  }),
}));

describe('ExtPremiumRow platform gating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePremiumStatus.mockReturnValue({
      data: { configured: true, premium: false, until: null, status: null },
    });
  });

  it('renders nothing and disables the status query in mobile store builds', () => {
    mockExternalPurchasesAllowed.mockReturnValue(false);

    const view = render(<ExtPremiumRow />);

    expect(view.toJSON()).toBeNull();
    expect(mockUsePremiumStatus).toHaveBeenCalledWith(false);
  });

  it('keeps the configured Android checkout entry point', () => {
    mockExternalPurchasesAllowed.mockReturnValue(true);

    const { getByLabelText } = render(<ExtPremiumRow />);
    fireEvent.press(getByLabelText('Go Premium'));

    expect(mockUsePremiumStatus).toHaveBeenCalledWith(true);
    expect(mockCheckoutMutate).toHaveBeenCalledTimes(1);
  });
});
