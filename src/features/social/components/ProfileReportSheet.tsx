import React from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing } from '../../../shared/constants/theme';
import type { ReportReason } from '../services/socialService';

interface ProfileReportSheetProps {
  visible: boolean;
  targetLabel: string;
  submitting?: boolean;
  onClose: () => void;
  onSelect: (reason: ReportReason) => void;
}

const REASONS: readonly {
  value: ReportReason;
  icon: 'report' | 'person-off' | 'no-accounts' | 'more-horiz';
}[] = [
  { value: 'spam', icon: 'report' },
  { value: 'harassment', icon: 'person-off' },
  { value: 'fake_profile', icon: 'no-accounts' },
  { value: 'other', icon: 'more-horiz' },
];

/** Cross-platform profile-report picker; Android native alerts only allow three buttons. */
export const ProfileReportSheet: React.FC<ProfileReportSheetProps> = ({
  visible,
  targetLabel,
  submitting = false,
  onClose,
  onSelect,
}) => {
  const { t } = useTranslation();

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
        accessibilityLabel={t('common.close')}
      >
        <Pressable style={styles.sheet} onPress={() => undefined} accessibilityViewIsModal>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>{t('profile.reportTitle', { handle: targetLabel })}</Text>
              <Text style={styles.subtitle}>{t('profile.reportReason')}</Text>
            </View>
            <Pressable
              onPress={onClose}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              hitSlop={8}
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
              accessibilityLabel={t(`profile.reasons.${reason.value}`)}
              style={({ pressed }) => [
                styles.reason,
                pressed && !submitting ? styles.reasonPressed : null,
              ]}
            >
              <MaterialIcons name={reason.icon} size={21} color={colors.danger} />
              <Text style={styles.reasonText}>{t(`profile.reasons.${reason.value}`)}</Text>
              <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} />
            </Pressable>
          ))}

          {submitting ? (
            <View style={styles.progress} accessibilityRole="progressbar">
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.progressText}>{t('moderation.submitting')}</Text>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.modalBackdropStrong,
  },
  sheet: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.giant,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.surfaceHigh,
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
