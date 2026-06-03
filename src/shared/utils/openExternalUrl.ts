import { Linking } from 'react-native';

/** Stripe-hosted Checkout / billing-portal hosts (matches host or any subdomain). */
export const STRIPE_HOSTS = ['stripe.com'] as const;

/**
 * Open a server-provided external URL via the OS handler, but only after
 * asserting it is an https URL — and, when `allowedHosts` is given, that its
 * host is on the allowlist (defence in depth against an open-redirect or a
 * non-https scheme slipping through a compromised/buggy API response).
 *
 * Returns false when the URL is rejected or fails to open; the caller surfaces
 * its own error UI.
 */
export const openExternalUrl = async (
  url: string,
  allowedHosts?: readonly string[],
): Promise<boolean> => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (
    allowedHosts &&
    !allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`))
  ) {
    return false;
  }
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
};
