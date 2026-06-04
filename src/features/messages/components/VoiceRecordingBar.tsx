import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '../../../shared/constants/theme';

interface VoiceRecordingBarProps {
  elapsedMs: number;
  isUploading: boolean;
  onCancel: () => void;
  onSend: () => void;
  bottomInset: number;
  keyboardVisible: boolean;
}

const formatClock = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Replaces the text input row while a voice note is being recorded/uploaded:
 * [discard] · [● rec timer] · [send]. Shared by the 1:1 and group threads.
 */
const VoiceRecordingBar: React.FC<VoiceRecordingBarProps> = ({
  elapsedMs,
  isUploading,
  onCancel,
  onSend,
  bottomInset,
  keyboardVisible,
}) => {
  const { t } = useTranslation();
  return (
    <View
      style={[
        styles.footer,
        { paddingBottom: keyboardVisible ? spacing.md : bottomInset + spacing.md },
      ]}
    >
      <Pressable
        onPress={onCancel}
        disabled={isUploading}
        accessibilityRole="button"
        accessibilityLabel={t('voice.cancelA11y')}
        hitSlop={8}
        style={styles.iconBtn}
      >
        <MaterialIcons name="delete-outline" size={24} color={colors.textMuted} />
      </Pressable>
      <View style={styles.center}>
        {isUploading ? (
          <Text style={styles.label}>{t('voice.sending')}</Text>
        ) : (
          <>
            <View style={styles.dot} />
            <Text style={styles.label}>{formatClock(elapsedMs)}</Text>
            <Text style={styles.hint}>{t('voice.recording')}</Text>
          </>
        )}
      </View>
      <Pressable
        onPress={onSend}
        disabled={isUploading}
        accessibilityRole="button"
        accessibilityLabel={t('voice.sendA11y')}
        style={styles.sendBtn}
      >
        {isUploading ? (
          <ActivityIndicator color={colors.onPrimary} size="small" />
        ) : (
          <MaterialIcons name="send" size={20} color={colors.onPrimary} />
        )}
      </Pressable>
    </View>
  );
};

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
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ff3b30' },
  label: { color: colors.text, fontSize: 14, fontVariant: ['tabular-nums'] },
  hint: { color: colors.textMuted, fontSize: 12 },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default VoiceRecordingBar;
