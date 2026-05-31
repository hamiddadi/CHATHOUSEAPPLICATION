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

export const useOnboardingStore = create<OnboardingState>(set => ({
  interests: [],
  setProfile: input =>
    set(state => ({
      displayName: input.displayName ?? state.displayName,
      firstName: input.firstName ?? state.firstName,
      lastName: input.lastName ?? state.lastName,
      bio: input.bio ?? state.bio,
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
