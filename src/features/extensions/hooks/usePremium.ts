import { useMutation, useQuery } from '@tanstack/react-query';
import { premiumApi, type PremiumStatus } from '../api/premiumApi';

export const premiumKeys = {
  status: ['ext', 'premium', 'status'] as const,
};

/** Server-side entitlement status (drives the badge + gating UI). Cached 60s. */
export const usePremiumStatus = () =>
  useQuery<PremiumStatus>({
    queryKey: premiumKeys.status,
    queryFn: () => premiumApi.status(),
    staleTime: 60_000,
  });

/** Start a subscription Checkout → returns the hosted-page URL to open. */
export const useStartPremiumCheckout = () =>
  useMutation<{ url: string }, unknown, string | undefined>({
    mutationFn: currency => premiumApi.checkout(currency),
  });

/** Open the Stripe billing portal → returns the hosted-page URL to open. */
export const useOpenBillingPortal = () =>
  useMutation<{ url: string }, unknown, void>({
    mutationFn: () => premiumApi.portal(),
  });
