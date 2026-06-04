import { apiClient } from '../../../shared/services/api/apiClient';

export interface PaymentStatus {
  configured: boolean;
}
export interface PaymentAccount {
  connected: boolean;
  kycComplete: boolean;
  accountId?: string;
}
/** Tips go through Stripe-hosted Checkout — the client opens this URL. */
export interface TipResult {
  url: string;
}
export interface TipHistoryItem {
  id: string;
  direction: 'sent' | 'received';
  fromUserId: string;
  toUserId: string;
  amount: number;
  currency: string;
  createdAt: string;
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
  /**
   * Start a tip: returns a Stripe Checkout URL the client opens (destination
   * charge to the creator, 100% to them). `amountCents` is in the currency's
   * minor units; `currency` defaults server-side when omitted.
   */
  async tip(toUserId: string, amountCents: number, currency?: string): Promise<TipResult> {
    const { data } = await apiClient.post<TipResult>('/ext/payments/tip', {
      toUserId,
      amountCents,
      ...(currency ? { currency } : {}),
    });
    return data;
  },
  async tipHistory(): Promise<TipHistoryItem[]> {
    const { data } = await apiClient.get<TipHistoryItem[]>('/ext/payments/tips');
    return data;
  },
};
