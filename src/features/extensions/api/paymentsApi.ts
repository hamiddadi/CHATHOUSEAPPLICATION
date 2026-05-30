import { apiClient } from '../../../shared/services/api/apiClient';

export interface PaymentStatus {
  configured: boolean;
}
export interface PaymentAccount {
  connected: boolean;
  kycComplete: boolean;
  accountId?: string;
}
export interface TipResult {
  clientSecret: string | null;
  paymentIntentId: string;
}

export const paymentsApi = {
  async status(): Promise<PaymentStatus> {
    const { data } = await apiClient.get<PaymentStatus>('/ext/payments/status');
    return data;
  },
  async onboard(): Promise<{ url: string; accountId: string }> {
    const { data } = await apiClient.post<{ url: string; accountId: string }>(
      '/ext/payments/onboard',
      {},
    );
    return data;
  },
  async account(): Promise<PaymentAccount> {
    const { data } = await apiClient.get<PaymentAccount>('/ext/payments/account');
    return data;
  },
  async tip(toUserId: string, amountCents: number): Promise<TipResult> {
    const { data } = await apiClient.post<TipResult>('/ext/payments/tip', {
      toUserId,
      amountCents,
    });
    return data;
  },
};
