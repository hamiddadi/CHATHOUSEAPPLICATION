import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { UserSummary } from '../../../shared/types/domain';
import { ExtTipSheet } from './ExtTipSheet';

const mockExternalPurchasesAllowed = jest.fn();
const mockTipMutate = jest.fn();

jest.mock('../utils/digitalPurchases', () => ({
  areExternalDigitalPurchasesAllowed: () => mockExternalPurchasesAllowed(),
}));

jest.mock('../hooks/useTip', () => ({
  useTip: () => ({
    mutate: mockTipMutate,
    isPending: false,
  }),
}));

const target: UserSummary = {
  id: 'creator-1',
  username: 'creator',
  displayName: 'Creator',
  avatarUrl: null,
};

describe('ExtTipSheet platform gating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing in mobile store builds even when a target is selected', () => {
    mockExternalPurchasesAllowed.mockReturnValue(false);

    expect(render(<ExtTipSheet target={target} onClose={jest.fn()} />).toJSON()).toBeNull();
    expect(mockTipMutate).not.toHaveBeenCalled();
  });

  it('keeps the Android tip mutation available', () => {
    mockExternalPurchasesAllowed.mockReturnValue(true);

    const { getByLabelText } = render(<ExtTipSheet target={target} onClose={jest.fn()} />);
    fireEvent.press(getByLabelText('€2'));

    expect(mockTipMutate).toHaveBeenCalledWith(
      { toUserId: 'creator-1', amountCents: 200, currency: 'eur' },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });
});
