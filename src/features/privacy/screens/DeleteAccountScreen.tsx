import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../shared/components/Button';
import { colors, radii, spacing } from '../../../shared/constants/theme';
import { useAuthStore } from '../../auth/store/authStore';
import { privacyService } from '../services/privacyService';
import { errorMessage } from '../../../shared/utils/errorMessage';

export const DeleteAccountScreen: React.FC = () => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const signOut = useAuthStore(s => s.signOut);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const confirmPhrase = t('privacy.delete.confirmPhrase', 'DELETE');
  const canDelete = confirm.trim().toUpperCase() === confirmPhrase.toUpperCase() && !busy;

  const handleDelete = useCallback(() => {
    Alert.alert(
      t('privacy.delete.title'),
      `${t('privacy.delete.description')}\n\n${t('privacy.delete.grace')}`,
      [
        { text: t('privacy.delete.buttonCancel'), style: 'cancel' },
        {
          text: t('privacy.delete.buttonDelete'),
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await privacyService.requestDeletion();
              await signOut();
            } catch (e) {
              Alert.alert(
                t('privacy.delete.errorTitle'),
                errorMessage(e, t('privacy.delete.errorBody')),
              );
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }, [signOut, t]);

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        paddingTop: insets.top + spacing.xxl,
        paddingHorizontal: spacing.xxl,
        paddingBottom: insets.bottom + spacing.giant,
        gap: spacing.lg,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.h1} accessibilityRole="header">
        {t('privacy.delete.title')}
      </Text>

      <View style={styles.warningCard}>
        <Text style={styles.warningTitle}>
          {t('privacy.delete.warningTitle', '⚠️ Near-irreversible action')}
        </Text>
        <Text style={styles.warningBody}>{t('privacy.delete.grace')}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('privacy.delete.beforeDelete', 'Before deleting')}</Text>
        <Text style={styles.body}>
          {t(
            'privacy.delete.stepExport',
            '• You can export your data from Settings → Privacy → Export my data.',
          )}
        </Text>
        <Text style={styles.body}>
          {t('privacy.delete.stepRooms', '• Rooms you hosted will be closed if they are active.')}
        </Text>
        <Text style={styles.body}>
          {t(
            'privacy.delete.stepMessages',
            '• Direct messages you sent to other users will remain visible to the recipient (cannot be retracted after sending).',
          )}
        </Text>
      </View>

      <View>
        <Text style={styles.confirmLabel}>
          {t('privacy.delete.confirmInputLabel')}{' '}
          <Text style={styles.confirmPhrase}>{confirmPhrase}</Text>
        </Text>
        <TextInput
          value={confirm}
          onChangeText={setConfirm}
          placeholder={confirmPhrase}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          style={styles.input}
          accessibilityLabel={t('privacy.delete.a11yInput', 'Deletion confirmation input')}
        />
      </View>

      <Button
        label={busy ? '...' : t('privacy.delete.buttonDelete')}
        variant="danger"
        size="lg"
        fullWidth
        disabled={!canDelete}
        loading={busy}
        onPress={handleDelete}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  h1: { color: colors.text, fontSize: 24, fontWeight: '700' },
  // Saturated-red literals (NOT withAlpha(colors.danger,…)). colors.danger is
  // the pale error *foreground* role (#ffb4ab) and stays as the warningTitle/
  // confirmPhrase text color; the card fill + border keep the vivid #ef4444
  // 'danger zone' affordance for this irreversible-deletion warning.
  warningCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    gap: spacing.sm,
  },
  warningTitle: { color: colors.danger, fontSize: 14, fontWeight: '700' },
  warningBody: { color: colors.text, fontSize: 13, lineHeight: 19 },
  card: {
    backgroundColor: colors.overlayWhite4,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    gap: 6,
  },
  cardTitle: { color: colors.text, fontSize: 13, fontWeight: '700', marginBottom: 4 },
  body: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  confirmLabel: { color: colors.text, fontSize: 13, marginBottom: spacing.sm },
  confirmPhrase: { color: colors.danger, fontWeight: '700' },
  input: {
    backgroundColor: colors.overlayWhite5,
    color: colors.text,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.overlayWhite15,
    fontSize: 15,
    letterSpacing: 1,
  },
});
