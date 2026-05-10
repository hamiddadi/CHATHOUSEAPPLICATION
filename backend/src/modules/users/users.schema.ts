import { z } from 'zod';

export const updateMeSchema = z
  .object({
    displayName: z.string().min(1).max(60).optional(),
    bio: z.string().max(280).optional(),
    avatarUrl: z.string().url().max(500).optional(),
  })
  .strict();

export const visibilitySchema = z.object({
  isVisible: z.boolean(),
});

export const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(60),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const usernameAvailabilitySchema = z.object({
  q: z
    .string()
    .min(3)
    .max(24)
    .regex(/^[a-z0-9_]+$/i, 'letters, digits and underscores only'),
});

export const setUsernameSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(24)
    .regex(/^[a-z0-9_]+$/i, 'letters, digits and underscores only'),
});

export const interestsSchema = z.object({
  // 1..10 keeps the interest pane manageable and prevents bloat. Tags
  // are free-form for now — the frontend curates the pickable list.
  interests: z.array(z.string().min(1).max(32)).min(1).max(10),
});

export const completeOnboardingSchema = z.object({
  // Accept the final profile details as one payload so the screen can
  // submit once. All fields optional — onboarding can be completed
  // without filling the optional profile screen first (a user can still
  // flip the flag directly).
  displayName: z.string().min(1).max(60).optional(),
  bio: z.string().max(280).optional(),
  avatarUrl: z.string().url().max(500).nullish(),
  interests: z.array(z.string().min(1).max(32)).min(1).max(10).optional(),
});

export type UpdateMeInput = z.infer<typeof updateMeSchema>;
export type VisibilityInput = z.infer<typeof visibilitySchema>;
export type LocationInput = z.infer<typeof locationSchema>;
export type SearchQueryInput = z.infer<typeof searchQuerySchema>;
export type UsernameAvailabilityInput = z.infer<typeof usernameAvailabilitySchema>;
export type SetUsernameInput = z.infer<typeof setUsernameSchema>;
export type InterestsInput = z.infer<typeof interestsSchema>;
export type CompleteOnboardingInput = z.infer<typeof completeOnboardingSchema>;
