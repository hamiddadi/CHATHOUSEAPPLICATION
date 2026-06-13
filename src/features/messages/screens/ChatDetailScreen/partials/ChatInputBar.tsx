import React, { memo } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { GradientView } from '../../../../../shared/components/GradientView';
import { colors, spacing } from '../../../../../shared/constants/theme';

const INPUT_ICON_SIZE = 22;
const SEND_BTN_SIZE = 44;

const GLASS_BG = 'rgba(255,255,255,0.05)';
const SEND_GRADIENT = ['#b0c6ff', '#558dff'] as const;

interface ChatInputBarProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  /** True when the draft is sendable; gates the send vs. mic button branch. */
  canSend: boolean;
  /** Bottom safe-area inset; applied only when the keyboard is hidden. */
  bottomInset: number;
  keyboardVisible: boolean;
  onEmoji: () => void;
  onAttach: () => void;
  onMic: () => void;
  onInputFocus: () => void;
}

const ChatInputBar: React.FC<ChatInputBarProps> = memo(
  ({
    value,
    onChangeText,
    onSend,
    canSend,
    bottomInset,
    keyboardVisible,
    onEmoji,
    onAttach,
    onMic,
    onInputFocus,
  }) => {
    const { t } = useTranslation();

    return (
      <View
        style={[
          styles.footer,
          { paddingBottom: keyboardVisible ? spacing.md : bottomInset + spacing.md },
        ]}
      >
        <View style={styles.inputPill}>
          <Pressable
            onPress={onEmoji}
            accessibilityRole="button"
            accessibilityLabel={t('chat.emojiA11y')}
            hitSlop={8}
          >
            <MaterialIcons
              name="sentiment-satisfied"
              size={INPUT_ICON_SIZE}
              color={colors.textMuted}
            />
          </Pressable>
          <TextInput
            style={styles.input}
            placeholder={t('chat.inputPlaceholder')}
            placeholderTextColor={'rgba(194,198,215,0.5)'}
            value={value}
            onChangeText={onChangeText}
            onFocus={onInputFocus}
            multiline
          />
          <Pressable
            onPress={onAttach}
            accessibilityRole="button"
            accessibilityLabel={t('chat.attachA11y')}
            hitSlop={8}
          >
            <MaterialIcons name="attach-file" size={INPUT_ICON_SIZE} color={colors.textMuted} />
          </Pressable>
        </View>
        {canSend ? (
          <Pressable
            onPress={onSend}
            accessibilityRole="button"
            accessibilityLabel={t('chat.sendA11y')}
            disabled={!canSend}
            className="rounded-pill overflow-hidden active:opacity-90"
          >
            <GradientView
              colors={SEND_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.sendBtn}
            >
              <MaterialIcons name="send" size={INPUT_ICON_SIZE} color={colors.onPrimary} />
            </GradientView>
          </Pressable>
        ) : (
          <Pressable
            onPress={onMic}
            accessibilityRole="button"
            accessibilityLabel={t('chat.micA11y')}
            style={styles.micBtn}
          >
            <MaterialIcons name="mic" size={INPUT_ICON_SIZE} color={colors.textMuted} />
          </Pressable>
        )}
      </View>
    );
  },
);
ChatInputBar.displayName = 'ChatInputBar';

const styles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  inputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: GLASS_BG,
    borderRadius: 9999,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    minHeight: 44,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    paddingVertical: 0,
    maxHeight: 100,
  },
  sendBtn: {
    width: SEND_BTN_SIZE,
    height: SEND_BTN_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtn: {
    width: SEND_BTN_SIZE,
    height: SEND_BTN_SIZE,
    borderRadius: SEND_BTN_SIZE / 2,
    backgroundColor: GLASS_BG,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default ChatInputBar;
