import React, { useCallback, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ReasonPromptModal, type ReasonPromptConfig } from '../components/ReasonPromptModal';

export interface ReasonPromptOptions {
  title: string;
  message: string;
  confirmLabel: string;
  defaultReason: string;
  cancelLabel?: string;
  placeholder?: string;
}

/**
 * Cross-platform reason collection.
 *
 * On iOS it uses the native `Alert.prompt` (a real text field). On Android —
 * where `Alert.prompt` is a silent no-op — it renders a feature-local modal
 * ({@link ReasonPromptModal}) with a multiline field and Confirm/Cancel.
 *
 * `prompt(options)` resolves with the collected reason (trimmed, or
 * `defaultReason` when empty) when confirmed, or `null` when cancelled. The
 * returned `modal` element must be mounted somewhere in the screen tree for the
 * Android path to work.
 */
export const useReasonPrompt = (): {
  prompt: (options: ReasonPromptOptions) => Promise<string | null>;
  modal: React.ReactNode;
} => {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ReasonPromptConfig | null>(null);
  const resolverRef = useRef<((reason: string | null) => void) | null>(null);

  const settle = useCallback((reason: string | null) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setConfig(null);
    resolve?.(reason);
  }, []);

  const prompt = useCallback(
    (options: ReasonPromptOptions): Promise<string | null> => {
      const cancelLabel = options.cancelLabel ?? t('common.cancel', 'Cancel');

      if (Platform.OS === 'ios') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const alertPrompt = (Alert as any).prompt as
          | ((
              title: string,
              message: string | undefined,
              buttons: Array<{
                text?: string;
                style?: 'default' | 'cancel' | 'destructive';
                onPress?: (text?: string) => void;
              }>,
              type?: 'default' | 'plain-text' | 'secure-text',
            ) => void)
          | undefined;
        if (alertPrompt) {
          return new Promise<string | null>(resolve => {
            alertPrompt(
              options.title,
              options.message,
              [
                { text: cancelLabel, style: 'cancel', onPress: () => resolve(null) },
                {
                  text: options.confirmLabel,
                  style: 'destructive',
                  onPress: (text?: string) => resolve((text ?? '').trim() || options.defaultReason),
                },
              ],
              'plain-text',
            );
          });
        }
      }

      // Android (and any platform without Alert.prompt): open the modal.
      return new Promise<string | null>(resolve => {
        resolverRef.current = resolve;
        setConfig({
          title: options.title,
          message: options.message,
          confirmLabel: options.confirmLabel,
          cancelLabel,
          defaultReason: options.defaultReason,
          placeholder: options.placeholder,
        });
      });
    },
    [t],
  );

  const modal = (
    <ReasonPromptModal
      config={config}
      onConfirm={reason => settle(reason)}
      onCancel={() => settle(null)}
    />
  );

  return { prompt, modal };
};
