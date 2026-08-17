import { Platform } from 'react-native';

export const EXTERNAL_DIGITAL_PURCHASES_DISABLED_MESSAGE =
  'External digital purchases are disabled in mobile store builds';

/**
 * Stripe-hosted purchases are disabled in iOS and Android store builds.
 * Re-enable a mobile platform only after its native billing implementation (or
 * a formally enrolled regional alternative-billing flow) is available.
 */
export const areExternalDigitalPurchasesAllowed = (platform: string = Platform.OS): boolean =>
  platform !== 'ios' && platform !== 'android';

/**
 * Defense-in-depth for callers that bypass the guarded UI.
 */
export const assertExternalDigitalPurchasesAllowed = (platform: string = Platform.OS): void => {
  if (!areExternalDigitalPurchasesAllowed(platform)) {
    throw new Error(EXTERNAL_DIGITAL_PURCHASES_DISABLED_MESSAGE);
  }
};
