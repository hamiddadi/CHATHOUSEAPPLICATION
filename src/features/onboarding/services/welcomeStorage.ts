import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Tracks whether the user has seen the pre-auth pedagogical carousel.
 * Kept in AsyncStorage (not SecureStore) because the flag is not
 * sensitive — missing it just re-shows the slides, worst case.
 */
const KEY = 'chathouse.welcomeSlides.completed.v1';

export const welcomeStorage = {
  async hasSeen(): Promise<boolean> {
    try {
      const v = await AsyncStorage.getItem(KEY);
      return v === '1';
    } catch {
      return false;
    }
  },

  async markSeen(): Promise<void> {
    try {
      await AsyncStorage.setItem(KEY, '1');
    } catch {
      // Silent — next launch just shows the slides again.
    }
  },

  async reset(): Promise<void> {
    await AsyncStorage.removeItem(KEY).catch(() => undefined);
  },
};
