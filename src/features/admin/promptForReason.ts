import { Alert } from 'react-native';

/**
 * Alert.prompt is iOS-only. This helper collects a free-text reason on iOS and,
 * on platforms without `Alert.prompt`, falls back to either a confirmation
 * dialog (when `androidConfirm` is provided) or an immediate call with
 * `defaultReason`. The collected text is trimmed and, if empty, replaced by
 * `defaultReason`. `onSubmit` only fires when the user confirms.
 */
export interface PromptForReasonOptions {
  /** Title shown in the iOS prompt (and the Android confirmation, if any). */
  title: string;
  /** Body text of the iOS prompt. */
  message: string;
  /** Label of the confirming/destructive button. */
  confirmLabel: string;
  /** Reason used when the field is left empty (and in the no-prompt fallback). */
  defaultReason: string;
  /** Label of the cancel button. Defaults to "Annuler". */
  cancelLabel?: string;
  /**
   * When set, platforms without `Alert.prompt` show a confirmation `Alert.alert`
   * (with this message) before submitting `defaultReason`. When omitted, those
   * platforms submit `defaultReason` immediately without any dialog.
   */
  androidConfirm?: { message: string; confirmLabel: string };
}

type AlertPromptButton = {
  text?: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: (text: string | undefined) => void;
};

type AlertPrompt = (
  title: string,
  message?: string,
  buttons?: AlertPromptButton[],
  type?: 'default' | 'plain-text' | 'secure-text' | 'login-password',
) => void;

export const promptForReason = (
  options: PromptForReasonOptions,
  onSubmit: (reason: string) => void,
): void => {
  const { title, message, confirmLabel, defaultReason, androidConfirm } = options;
  const cancelLabel = options.cancelLabel ?? 'Annuler';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prompt = (Alert as any).prompt as AlertPrompt | undefined;

  if (prompt) {
    prompt(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel' },
        {
          text: confirmLabel,
          style: 'destructive',
          onPress: (text: string | undefined) => onSubmit((text ?? '').trim() || defaultReason),
        },
      ],
      'plain-text',
    );
    return;
  }

  if (androidConfirm) {
    Alert.alert(title, androidConfirm.message, [
      { text: cancelLabel, style: 'cancel' },
      {
        text: androidConfirm.confirmLabel,
        style: 'destructive',
        onPress: () => onSubmit(defaultReason),
      },
    ]);
    return;
  }

  onSubmit(defaultReason);
};
