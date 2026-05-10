import { z } from 'zod';

/**
 * Schemas mirror the backend Zod rules (users.schema.ts). Keep them in
 * sync when adding fields.
 */

export const setupProfileFormSchema = z.object({
  displayName: z
    .string()
    .transform(s => s.trim())
    .pipe(z.string().max(60, 'onboarding.setupProfile.errors.displayNameTooLong').optional())
    .optional(),
  bio: z
    .string()
    .transform(s => s.trim())
    .pipe(z.string().max(280, 'onboarding.setupProfile.errors.bioTooLong').optional())
    .optional(),
});

export type SetupProfileFormValues = z.infer<typeof setupProfileFormSchema>;

// Canonical list of interest tags the UI renders as chips. Stays in
// sync with `RoomCategory` in shared/types/domain.ts — if you add one
// here, add it there too. Backend normalises to lowercase so casing
// here is just a stable source-of-truth.
export const INTEREST_CATEGORIES = [
  'tech',
  'design',
  'crypto',
  'ai',
  'music',
  'business',
  'health',
] as const;

export type InterestCategory = (typeof INTEREST_CATEGORIES)[number];
