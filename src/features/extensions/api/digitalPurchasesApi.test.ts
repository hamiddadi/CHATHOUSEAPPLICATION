const mockPost = jest.fn();
const mockAssertExternalDigitalPurchasesAllowed = jest.fn();

jest.mock('../../../shared/services/api/apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

jest.mock('../utils/digitalPurchases', () => ({
  assertExternalDigitalPurchasesAllowed: () => mockAssertExternalDigitalPurchasesAllowed(),
}));

import { paymentsApi } from './paymentsApi';
import { premiumApi } from './premiumApi';

describe('digital purchase API guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPost.mockResolvedValue({ data: { url: 'https://checkout.stripe.com/test' } });
  });

  it.each([
    ['tip', () => paymentsApi.tip('creator-1', 500, 'eur')],
    ['Premium checkout', () => premiumApi.checkout('eur')],
    ['Premium portal', () => premiumApi.portal()],
  ])('refuses %s before an HTTP request when the platform guard blocks', async (_name, call) => {
    mockAssertExternalDigitalPurchasesAllowed.mockImplementationOnce(() => {
      throw new Error('disabled in mobile store builds');
    });

    await expect(call()).rejects.toThrow('disabled in mobile store builds');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('keeps the guarded non-store tip request contract unchanged', async () => {
    await paymentsApi.tip('creator-1', 500, 'eur');

    expect(mockAssertExternalDigitalPurchasesAllowed).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/ext/payments/tip', {
      toUserId: 'creator-1',
      amountCents: 500,
      currency: 'eur',
    });
  });
});
