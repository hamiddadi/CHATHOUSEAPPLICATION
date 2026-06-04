import { apiClient } from '../../../shared/services/api/apiClient';

/**
 * Premium subscription (Stripe-hosted Checkout + billing portal).
 *
 * Backend contract — backend/src/extensions/modules/premium:
 *   GET  /ext/premium/status   → PremiumStatus (server-side entitlement)
 *   POST /ext/premium/checkout → { url }  (open in browser to subscribe)
 *   POST /ext/premium/portal   → { url }  (manage/cancel)
 */

export interface PremiumStatus {
  configured: boolean;
  premium: boolean;
  until: string | null;
  status: string | null;
}

export const premiumApi = {
  async status(): Promise<PremiumStatus> {
    const { data } = await apiClient.get<PremiumStatus>('/ext/premium/status');
    return data;
  },
  async checkout(currency?: string): Promise<{ url: string }> {
    const { data } = await apiClient.post<{ url: string }>('/ext/premium/checkout', {
      ...(currency ? { currency } : {}),
    });
    return data;
  },
  async portal(): Promise<{ url: string }> {
    const { data } = await apiClient.post<{ url: string }>('/ext/premium/portal', {});
    return data;
  },
};
