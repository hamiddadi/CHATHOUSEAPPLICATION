import React, { useCallback, useRef, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
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
  const [copied, setCopied] = useState(false);
  // Hold the archive in component memory only — never auto-persisted to the
  // system clipboard. Copying is an explicit, opt-in action below.
  const archiveRef = useRef<string | null>(null);

  // Privacy: the export contains PII and message content. We hand it off via
  // the OS Share sheet (which carries the FULL archive) instead of silently
  // copying it to the system clipboard, where any other app can read it. A
  // dedicated file export (expo-sharing / expo-file-system) would be ideal but
  // those modules aren't installed in this build.
  // TODO(audit): add expo-sharing + expo-file-system to write the archive to a
  // private file and share it via the native file Share sheet.
  const handleExport = useCallback(async () => {
    setBusy(true);
    setCopied(false);
    try {
      const json = await privacyService.exportMyData();
      archiveRef.current = json;
      setLastBytes(json.length);
      // Share sheet carries the full archive (not truncated) — no clipboard.
      await Share.share({ message: json, title: t('privacy.export.title') });
    } catch (e) {
      Alert.alert(
        t('privacy.export.errorExportTitle'),
        errorMessage(e, t('privacy.export.errorExportBody')),
      );
    } finally {
      setBusy(false);
    }
  }, [t]);

  // Explicit opt-in copy. Users who really want the clipboard can choose it,
  // and we surface a one-tap way to wipe it again afterwards.
  const handleCopy = useCallback(async () => {
    if (!archiveRef.current) return;
    try {
      await Clipboard.setString(archiveRef.current);
      setCopied(true);
    } catch (e) {
      Alert.alert(
        t('privacy.export.errorExportTitle'),
        errorMessage(e, t('privacy.export.errorCopyBody')),
      );
    }
  }, [t]);

  const handleClearClipboard = useCallback(async () => {
    try {
      await Clipboard.setString('');
    } catch {
      /* best-effort */
    }
    setCopied(false);
  }, []);

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
        <>
          <Text style={styles.feedback} accessibilityLiveRegion="polite">
            {t('privacy.export.success', { size: (lastBytes / 1024).toFixed(1) })}
          </Text>
          <Text style={styles.muted}>{t('privacy.export.warning')}</Text>
          <Button
            label={t('privacy.export.buttonCopy')}
            variant="ghost"
            size="md"
            fullWidth
            onPress={handleCopy}
            accessibilityHint={t('privacy.export.warning')}
          />
          {copied ? (
            <Button
              label={t('privacy.export.buttonClear')}
              variant="outline"
              size="md"
              fullWidth
              onPress={handleClearClipboard}
            />
          ) : null}
        </>
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
