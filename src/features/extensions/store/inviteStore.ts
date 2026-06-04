import { create } from 'zustand';

/**
 * Holds the invite code captured from a deep link (`/invite/<code>`) until the
 * user finishes onboarding, at which point it's redeemed and cleared. Kept in
 * a zustand store (not React state) so the navigation `getStateFromPath` hook —
 * which runs outside the component tree — can stash the code via getState().
 */
interface InviteState {
  pendingCode: string | null;
  setPendingCode: (code: string) => void;
  clear: () => void;
}

export const useInviteStore = create<InviteState>(set => ({
  pendingCode: null,
  setPendingCode: code => set({ pendingCode: code }),
  clear: () => set({ pendingCode: null }),
}));
