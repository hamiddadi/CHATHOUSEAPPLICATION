import { Linking, Platform } from 'react-native';

/**
 * Open a Twitter / X handle in the native app, falling back to a browser.
 * Strips a leading '@' and validates the handle shape before opening.
 */
export const openTwitterHandle = async (rawHandle: string): Promise<void> => {
  const handle = sanitizeHandle(rawHandle);
  if (!handle) return;
  const webUrl = `https://x.com/${handle}`;
  const appUrl =
    Platform.select({
      ios: `twitter://user?screen_name=${handle}`,
      android: `twitter://user?screen_name=${handle}`,
      default: webUrl,
    }) ?? webUrl;
  await openWithFallback(appUrl, webUrl);
};

/**
 * Open an Instagram handle in the native app, falling back to a browser.
 */
export const openInstagramHandle = async (rawHandle: string): Promise<void> => {
  const handle = sanitizeHandle(rawHandle);
  if (!handle) return;
  const appUrl = `instagram://user?username=${handle}`;
  const webUrl = `https://instagram.com/${handle}`;
  await openWithFallback(appUrl, webUrl);
};

const sanitizeHandle = (input: string | null | undefined): string | null => {
  if (!input) return null;
  const cleaned = input.trim().replace(/^@+/, '');
  // Twitter: 1-15 chars; Instagram: 1-30 chars. Allow letters, digits, dot,
  // underscore.
  if (!/^[a-zA-Z0-9._]{1,30}$/.test(cleaned)) return null;
  return cleaned;
};

const openWithFallback = async (deep: string, web: string): Promise<void> => {
  try {
    const can = await Linking.canOpenURL(deep);
    if (can) {
      await Linking.openURL(deep);
      return;
    }
  } catch {
    /* fall through */
  }
  await Linking.openURL(web);
};
