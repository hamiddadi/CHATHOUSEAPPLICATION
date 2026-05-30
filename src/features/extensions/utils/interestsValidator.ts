/**
 * Pure validator helpers for onboarding interest selection (Clubhouse spec:
 * minimum 3 interests, maximum 50). Used by new onboarding screens or by
 * augmenting existing flows via a wrapped submit handler.
 */

export const INTEREST_MIN = 3;
export const INTEREST_MAX = 50;

export interface InterestValidationResult {
  ok: boolean;
  reason?: 'too_few' | 'too_many' | 'duplicates';
  missing?: number;
}

export const validateInterests = (
  selected: readonly string[],
  available?: readonly string[],
): InterestValidationResult => {
  const unique = Array.from(new Set(selected.map(s => s.trim()).filter(Boolean)));
  if (unique.length !== selected.length) {
    return { ok: false, reason: 'duplicates' };
  }
  if (unique.length < INTEREST_MIN) {
    return { ok: false, reason: 'too_few', missing: INTEREST_MIN - unique.length };
  }
  if (unique.length > INTEREST_MAX) {
    return { ok: false, reason: 'too_many' };
  }
  if (available && available.length > 0) {
    const set = new Set(available);
    for (const s of unique) {
      if (!set.has(s)) return { ok: false, reason: 'duplicates' };
    }
  }
  return { ok: true };
};
