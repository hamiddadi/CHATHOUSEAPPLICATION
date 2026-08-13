import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, layout, radii, spacing } from '../../constants/theme';
import type { ContentReportReason } from '../../types/moderation';

interface ContentReportSheetProps {
  visible: boolean;
  submitting?: boolean;
  onClose: () => void;
  onSelect: (reason: ContentReportReason) => void;
}

const REASONS: Array<{
  value: ContentReportReason;
  icon: 'report' | 'person-off' | 'more-horiz';
  labelKey: string;
  fallback: string;
}> = [
  { value: 'spam', icon: 'report', labelKey: 'moderation.reasons.spam', fallback: 'Spam' },
  {
    value: 'harassment',
    icon: 'person-off',
    labelKey: 'moderation.reasons.harassment',
    fallback: 'Harassment',
  },
  {
    value: 'other',
    icon: 'more-horiz',
    labelKey: 'moderation.reasons.other',
    fallback: 'Other',
  },
];

export const ContentReportSheet: React.FC<ContentReportSheetProps> = ({
  visible,
  submitting = false,
  onClose,
  onSelect,
}) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={submitting ? undefined : onClose}
    >
      <Pressable
        style={styles.backdrop}
        onPress={submitting ? undefined : onClose}
        accessible={false}
      >
        <Pressable
          style={styles.sheet}
          onPress={() => undefined}
          accessible={false}
          accessibilityViewIsModal
          importantForAccessibility="yes"
        >
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.sheetContent,
              { paddingBottom: Math.max(insets.bottom, spacing.xl) },
            ]}
          >
            <View style={styles.handle} />
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={styles.title} accessibilityRole="header">
                  {t('moderation.reportMessageTitle', 'Report this message')}
                </Text>
                <Text style={styles.subtitle}>
                  {t(
                    'moderation.reportMessageBody',
                    'Choose the reason. The moderation team will receive a copy of the message.',
                  )}
                </Text>
              </View>
              <Pressable
                onPress={onClose}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel={t('common.close', 'Close')}
                accessibilityState={{ disabled: submitting }}
                hitSlop={8}
                style={styles.closeButton}
              >
                <MaterialIcons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>

            {REASONS.map(reason => (
              <Pressable
                key={reason.value}
                onPress={() => onSelect(reason.value)}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel={t(reason.labelKey, reason.fallback)}
                accessibilityState={{ disabled: submitting }}
                style={({ pressed }) => [
                  styles.reason,
                  pressed && !submitting ? styles.reasonPressed : null,
                ]}
              >
                <MaterialIcons name={reason.icon} size={21} color={colors.danger} />
                <Text style={styles.reasonText}>{t(reason.labelKey, reason.fallback)}</Text>
                {submitting ? null : (
                  <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} />
                )}
              </Pressable>
            ))}

            {submitting ? (
              <View
                style={styles.progress}
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel={t('moderation.submitting', 'Sending report…')}
                accessibilityLiveRegion="polite"
              >
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.progressText}>
                  {t('moderation.submitting', 'Sending report…')}
                </Text>
              </View>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: colors.modalBackdropStrong,
  },
  sheet: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    maxHeight: '90%',
    overflow: 'hidden',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.surfaceHigh,
  },
  sheetContent: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.sm,
  },
  handle: {
    width: 36,
    height: 4,
    alignSelf: 'center',
    marginBottom: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.overlayWhite15,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headerText: { flex: 1, gap: spacing.xs },
  closeButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  reason: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.overlayWhite4,
  },
  reasonPressed: { opacity: 0.7 },
  reasonText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  progress: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  progressText: { color: colors.textMuted, fontSize: 12 },
});
