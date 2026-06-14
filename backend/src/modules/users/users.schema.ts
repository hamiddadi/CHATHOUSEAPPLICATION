import { z } from 'zod';

export const updateMeSchema = z
  .object({
    displayName: z.string().min(1).max(60).optional(),
    // Real name (Clubhouse-style identity). Optional and separate from the
    // public displayName/username. VarChar(50) in the schema → max 50.
    firstName: z.string().max(50).optional(),
    lastName: z.string().max(50).optional(),
    bio: z.string().max(150).optional(),
    avatarUrl: z.string().url().max(500).optional(),
    // Social handles — plain-text, not OAuth. VarChar(50) in the schema → max
    // 50. Allow the empty string so the user can clear a handle from the form.
    twitter: z.string().max(50).optional(),
    instagram: z.string().max(50).optional(),
  })
  .strict();

export const visibilitySchema = z.object({
  isVisible: z.boolean(),
});

// Whitelist of toggleable notification preferences. `.strict()` rejects any
// unexpected key so the raw body can't be mass-assigned into prisma.upsert.
export const notifPrefsSchema = z
  .object({
    newFollower: z.boolean().optional(),
    wave: z.boolean().optional(),
    roomInvite: z.boolean().optional(),
    clubInvite: z.boolean().optional(),
    roomStarted: z.boolean().optional(),
    eventReminder: z.boolean().optional(),
    newMessage: z.boolean().optional(),
    handAccepted: z.boolean().optional(),
    mention: z.boolean().optional(),
  })
  .strict();

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
  interests: z.array(z.string().min(1).max(32)).min(3).max(10),
});

export const completeOnboardingSchema = z.object({
  // Accept the final profile details as one payload so the screen can
  // submit once. All fields optional — onboarding can be completed
  // without filling the optional profile screen first (a user can still
  // flip the flag directly).
  displayName: z.string().min(1).max(60).optional(),
  firstName: z.string().max(50).optional(),
  lastName: z.string().max(50).optional(),
  bio: z.string().max(280).optional(),
  avatarUrl: z.string().url().max(500).nullish(),
  interests: z.array(z.string().min(1).max(32)).min(3).max(10).optional(),
});

export type UpdateMeInput = z.infer<typeof updateMeSchema>;
export type VisibilityInput = z.infer<typeof visibilitySchema>;
export type NotifPrefsInput = z.infer<typeof notifPrefsSchema>;
export type LocationInput = z.infer<typeof locationSchema>;
export type SearchQueryInput = z.infer<typeof searchQuerySchema>;
export type UsernameAvailabilityInput = z.infer<typeof usernameAvailabilitySchema>;
export type SetUsernameInput = z.infer<typeof setUsernameSchema>;
export type InterestsInput = z.infer<typeof interestsSchema>;
export type CompleteOnboardingInput = z.infer<typeof completeOnboardingSchema>;
