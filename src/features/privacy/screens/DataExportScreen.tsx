import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import NativeShare from 'react-native-share';
import { CachesDirectoryPath, unlink, writeFile } from '@dr.pogodin/react-native-fs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../shared/components/Button';
import { colors, radii, spacing } from '../../../shared/constants/theme';
import { errorMessage } from '../../../shared/utils/errorMessage';
import { privacyService } from '../services/privacyService';

export const DataExportScreen: React.FC = () => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [lastBytes, setLastBytes] = useState<number | null>(null);

  // The archive contains PII and message content. Keep it in the app's private
  // cache only long enough to share a real JSON attachment, then delete it on
  // success, cancellation and failure. It never touches the clipboard.
  const handleExport = useCallback(async () => {
    setBusy(true);
    setLastBytes(null);
    let temporaryPath: string | null = null;
    try {
      const json = await privacyService.exportMyData();
      const filename = `chathouse-export-${new Date().toISOString().slice(0, 10)}.json`;
      temporaryPath = `${CachesDirectoryPath}/${filename}`;
      await writeFile(temporaryPath, json, 'utf8');
      const result = await NativeShare.open({
        title: t('privacy.export.title'),
        subject: t('privacy.export.title'),
        url: `file://${temporaryPath}`,
        type: 'application/json',
        filename,
        failOnCancel: false,
        useInternalStorage: true,
      });
      if (result.success && !result.dismissedAction) {
        setLastBytes(json.length);
      }
    } catch (e) {
      Alert.alert(
        t('privacy.export.errorExportTitle'),
        errorMessage(e, t('privacy.export.errorExportBody')),
      );
    } finally {
      if (temporaryPath) {
        await unlink(temporaryPath).catch(() => undefined);
      }
      setBusy(false);
    }
  }, [t]);

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        paddingTop: insets.top + spacing.xxl,
        paddingHorizontal: spacing.xxl,
        paddingBottom: insets.bottom + spacing.giant,
        gap: spacing.lg,
      }}
    >
      <Text style={styles.h1}>{t('privacy.export.title')}</Text>
      <View style={styles.card}>
        <Text style={styles.body}>{t('privacy.export.description1')}</Text>
        <Text style={styles.body}>{t('privacy.export.description2')}</Text>
        <Text style={styles.muted}>{t('privacy.export.note')}</Text>
      </View>

      <Button
        label={busy ? t('privacy.export.buttonPrepare') : t('privacy.export.buttonExport')}
        variant="primary"
        size="lg"
        fullWidth
        loading={busy}
        onPress={handleExport}
        accessibilityHint={t('privacy.export.description1')}
      />

      {lastBytes !== null ? (
        <Text style={styles.feedback} accessibilityLiveRegion="polite">
          {t('privacy.export.success', { size: (lastBytes / 1024).toFixed(1) })}
        </Text>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  h1: { color: colors.text, fontSize: 24, fontWeight: '700' },
  card: {
    backgroundColor: colors.overlayWhite4,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    gap: spacing.sm,
  },
  body: { color: colors.text, fontSize: 13, lineHeight: 19 },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  feedback: { color: colors.primary, fontSize: 12, textAlign: 'center' },
});
