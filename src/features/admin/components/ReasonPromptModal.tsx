import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, withAlpha } from '../../../shared/constants/theme';

export interface ReasonPromptConfig {
  /** Dialog title. */
  title: string;
  /** Body/help text shown above the input. */
  message: string;
  /** Label of the confirming (destructive) button. */
  confirmLabel: string;
  /** Placeholder for the reason field. */
  placeholder?: string;
  /** Label of the cancel button. */
  cancelLabel: string;
  /** Reason used when the field is left empty. */
  defaultReason: string;
}

export interface ReasonPromptModalProps {
  /** When set, the modal is visible and rendered with this config. */
  config: ReasonPromptConfig | null;
  /** Called with the trimmed reason (falls back to `defaultReason` when empty). */
  onConfirm: (reason: string) => void;
  /** Called when the user cancels or dismisses. */
  onCancel: () => void;
}

/**
 * Feature-local reason-collection modal. Replaces `Alert.prompt` on Android
 * (where it is a silent no-op): a real RN Modal with a multiline TextInput for
 * the motif plus Confirm/Cancel buttons, styled for the dark theme.
 *
 * The confirm button is guarded against double-taps: once fired it disables
 * itself until the modal unmounts.
 */
export const ReasonPromptModal: React.FC<ReasonPromptModalProps> = ({
  config,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  // Anti double-tap: block a second confirm/cancel from firing the callback
  // while the parent is tearing the modal down.
  const submittedRef = useRef(false);

  // Reset the field + guard every time a new prompt opens.
  useEffect(() => {
    if (config) {
      setText('');
      submittedRef.current = false;
    }
  }, [config]);

  const visible = config !== null;

  const handleConfirm = (): void => {
    if (submittedRef.current || !config) return;
    submittedRef.current = true;
    onConfirm(text.trim() || config.defaultReason);
  };

  const handleCancel = (): void => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={config?.cancelLabel ?? t('common.cancel', 'Cancel')}
          onPress={handleCancel}
        />
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.title}>{config?.title}</Text>
          {config?.message ? <Text style={styles.message}>{config.message}</Text> : null}
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={config?.placeholder ?? config?.message}
            placeholderTextColor={colors.textMuted}
            multiline
            style={styles.input}
            accessibilityLabel={config?.message}
            autoFocus
            textAlignVertical="top"
          />
          <View style={styles.actions}>
            <Pressable
              onPress={handleCancel}
              style={[styles.btn, styles.cancelBtn]}
              accessibilityRole="button"
              accessibilityLabel={config?.cancelLabel ?? t('common.cancel', 'Cancel')}
            >
              <Text style={styles.cancelText}>{config?.cancelLabel}</Text>
            </Pressable>
            <Pressable
              onPress={handleConfirm}
              style={[styles.btn, styles.confirmBtn]}
              accessibilityRole="button"
              accessibilityLabel={config?.confirmLabel}
            >
              <Text style={styles.confirmText}>{config?.confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: withAlpha(colors.background, 0.7),
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surfaceHigh,
    borderRadius: radii.lg,
    padding: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    gap: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  message: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    minHeight: 88,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.overlayWhite15,
    backgroundColor: colors.overlayWhite5,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  btn: {
    flex: 1,
    minHeight: 44,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  cancelBtn: {
    borderWidth: 1,
    borderColor: colors.overlayWhite15,
  },
  confirmBtn: {
    backgroundColor: colors.danger,
  },
  cancelText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  confirmText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: '700',
  },
});
