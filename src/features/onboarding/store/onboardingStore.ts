import { create } from 'zustand';

/**
 * Ephemeral state held while the user walks through SetupProfile →
 * InterestSelection. Values accumulate across screens and are flushed
 * to the API in one PATCH call when the user taps "Finish".
 */

interface OnboardingState {
  displayName?: string;
  firstName?: string;
  lastName?: string;
  bio?: string;
  avatarUrl?: string | null;
  interests: string[];

  setProfile: (input: {
    displayName?: string;
    firstName?: string;
    lastName?: string;
    bio?: string;
    avatarUrl?: string | null;
  }) => void;
  setInterests: (interests: string[]) => void;
  reset: () => void;
}

/**
 * Merge helper for text fields: `undefined` means "not provided → keep the
 * previous value", while an explicit empty string means "clear it" (stored as
 * undefined so the final PATCH omits the field — the backend rejects '').
 */
const mergeText = (input: string | undefined, previous: string | undefined): string | undefined =>
  input === undefined ? previous : input.trim() || undefined;

export const useOnboardingStore = create<OnboardingState>(set => ({
  interests: [],
  setProfile: input =>
    set(state => ({
      displayName: mergeText(input.displayName, state.displayName),
      firstName: mergeText(input.firstName, state.firstName),
      lastName: mergeText(input.lastName, state.lastName),
      bio: mergeText(input.bio, state.bio),
      avatarUrl: input.avatarUrl === undefined ? state.avatarUrl : input.avatarUrl,
    })),
  setInterests: interests => set({ interests }),
  reset: () =>
    set({
      displayName: undefined,
      firstName: undefined,
      lastName: undefined,
      bio: undefined,
      avatarUrl: undefined,
      interests: [],
    }),
}));
