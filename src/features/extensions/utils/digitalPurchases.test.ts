import {
  EXTERNAL_DIGITAL_PURCHASES_DISABLED_MESSAGE,
  areExternalDigitalPurchasesAllowed,
  assertExternalDigitalPurchasesAllowed,
} from './digitalPurchases';

describe('external digital purchase platform guard', () => {
  it.each(['ios', 'android'])('blocks the %s store build', platform => {
    expect(areExternalDigitalPurchasesAllowed(platform)).toBe(false);
    expect(() => assertExternalDigitalPurchasesAllowed(platform)).toThrow(
      EXTERNAL_DIGITAL_PURCHASES_DISABLED_MESSAGE,
    );
  });

  it.each(['web', 'windows'])('keeps the non-store %s client enabled', platform => {
    expect(areExternalDigitalPurchasesAllowed(platform)).toBe(true);
    expect(() => assertExternalDigitalPurchasesAllowed(platform)).not.toThrow();
  });
});
