import { trigger } from 'react-native-haptic-feedback';

/**
 * Haptics helpers — a thin wrapper over `react-native-haptic-feedback` that
 * replaces `expo-haptics` (de-Expo migration). Centralizing the trigger options
 * and the expo→RN feedback-type mapping keeps call sites to a single import +
 * one-line call, and confines the only dependency on the native module here.
 *
 * Mapping from the former expo-haptics API:
 *   impactAsync(ImpactFeedbackStyle.Light)        -> impactLight()
 *   notificationAsync(NotificationFeedbackType.Success) -> notifySuccess()
 *   selectionAsync()                              -> selection()
 */
const OPTIONS = {
  enableVibrateFallback: true,
  ignoreAndroidSystemSettings: false,
};

/** Light tap — fired on button press-in, reaction taps, avatar pick. */
export const impactLight = (): void => {
  trigger('impactLight', OPTIONS);
};

/** Success cue — fired on role promotion, profile save, copy success. */
export const notifySuccess = (): void => {
  trigger('notificationSuccess', OPTIONS);
};

/** Selection tick — fired when picking an emoji reaction. */
export const selection = (): void => {
  trigger('selection', OPTIONS);
};
