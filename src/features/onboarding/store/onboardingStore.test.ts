/**
 * Unit tests for the onboarding store's merge semantics. `setProfile` must
 * distinguish "field not provided" (undefined → keep the previous value) from
 * an explicit clear ('' → drop it), so SetupProfile can erase a displayName
 * typed on an earlier pass instead of it silently sticking around.
 */
import { useOnboardingStore } from './onboardingStore';

describe('useOnboardingStore', () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset();
  });

  it('setProfile keeps previous text values when the field is not provided', () => {
    useOnboardingStore.getState().setProfile({ displayName: 'Alice', bio: 'Hi there' });
    useOnboardingStore.getState().setProfile({ bio: 'Updated bio' });
    const state = useOnboardingStore.getState();
    expect(state.displayName).toBe('Alice');
    expect(state.bio).toBe('Updated bio');
  });

  it("setProfile clears a text value on explicit ''", () => {
    useOnboardingStore.getState().setProfile({ displayName: 'Alice' });
    useOnboardingStore.getState().setProfile({ displayName: '' });
    expect(useOnboardingStore.getState().displayName).toBeUndefined();
  });

  it('setProfile trims text values and treats whitespace-only as a clear', () => {
    useOnboardingStore.getState().setProfile({ displayName: '  Bob  ' });
    expect(useOnboardingStore.getState().displayName).toBe('Bob');
    useOnboardingStore.getState().setProfile({ displayName: '   ' });
    expect(useOnboardingStore.getState().displayName).toBeUndefined();
  });

  it('setProfile keeps avatarUrl on undefined but honours an explicit null', () => {
    useOnboardingStore.getState().setProfile({ avatarUrl: 'https://cdn.test/a.jpg' });
    useOnboardingStore.getState().setProfile({ displayName: 'Alice' });
    expect(useOnboardingStore.getState().avatarUrl).toBe('https://cdn.test/a.jpg');
    useOnboardingStore.getState().setProfile({ avatarUrl: null });
    expect(useOnboardingStore.getState().avatarUrl).toBeNull();
  });

  it('reset wipes every field back to the initial state', () => {
    useOnboardingStore.getState().setProfile({ displayName: 'Alice', bio: 'Hi' });
    useOnboardingStore.getState().setInterests(['tech', 'design']);
    useOnboardingStore.getState().reset();
    const state = useOnboardingStore.getState();
    expect(state.displayName).toBeUndefined();
    expect(state.bio).toBeUndefined();
    expect(state.avatarUrl).toBeUndefined();
    expect(state.interests).toEqual([]);
  });
});
