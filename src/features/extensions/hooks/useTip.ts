import { useMutation } from '@tanstack/react-query';
import { paymentsApi, type TipResult } from '../api/paymentsApi';

export interface TipVars {
  toUserId: string;
  amountCents: number;
  currency?: string;
}

/** Start a tip → returns a Stripe Checkout URL the caller opens in the browser. */
export const useTip = () =>
  useMutation<TipResult, unknown, TipVars>({
    mutationFn: ({ toUserId, amountCents, currency }) =>
      paymentsApi.tip(toUserId, amountCents, currency),
  });
