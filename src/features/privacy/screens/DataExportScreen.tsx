import React, { useCallback, useRef, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../../shared/components/Button';
import { colors, spacing } from '../../../shared/constants/theme';
import { privacyService } from '../services/privacyService';

export const DataExportScreen: React.FC = () => {
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
      await Share.share({ message: json, title: 'Mon export Chathouse (RGPD)' });
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec de l’export');
    } finally {
      setBusy(false);
    }
  }, []);

  // Explicit opt-in copy. Users who really want the clipboard can choose it,
  // and we surface a one-tap way to wipe it again afterwards.
  const handleCopy = useCallback(async () => {
    if (!archiveRef.current) return;
    try {
      await Clipboard.setStringAsync(archiveRef.current);
      setCopied(true);
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec de la copie');
    }
  }, []);

  const handleClearClipboard = useCallback(async () => {
    try {
      await Clipboard.setStringAsync('');
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
      <Text style={styles.h1}>Exporter mes données</Text>
      <View style={styles.card}>
        <Text style={styles.body}>
          Conformément à l&apos;article 20 du RGPD (droit à la portabilité), vous pouvez télécharger
          une copie complète de l&apos;ensemble de vos données personnelles dans un fichier JSON
          structuré.
        </Text>
        <Text style={styles.body}>
          L&apos;archive contient : votre profil, vos rooms hébergées, vos participations, votre
          graphe d&apos;abonnements, vos messages directs, vos messages de room, vos RSVP, la liste
          de vos appareils (plateforme et dates, sans le jeton secret) et vos préférences de
          notification.
        </Text>
        <Text style={styles.muted}>
          Note : le journal d&apos;audit (actions de modération) et les signalements émis contre
          votre compte ne sont pas inclus, conformément à l&apos;article 23 du RGPD (intérêt
          légitime de modération).
        </Text>
      </View>

      <Button
        label={busy ? 'Préparation…' : 'Générer et partager mon export'}
        variant="primary"
        size="lg"
        fullWidth
        loading={busy}
        onPress={handleExport}
      />

      {lastBytes !== null ? (
        <>
          <Text style={styles.feedback}>
            ✓ Export généré ({(lastBytes / 1024).toFixed(1)} Ko) — partagez-le via le menu de
            partage.
          </Text>
          <Text style={styles.muted}>
            Le presse-papier est lisible par d&apos;autres applications. Ne copiez l&apos;archive
            que si nécessaire, puis effacez le presse-papier.
          </Text>
          <Button
            label="Copier dans le presse-papier"
            variant="ghost"
            size="md"
            fullWidth
            onPress={handleCopy}
          />
          {copied ? (
            <Button
              label="Effacer le presse-papier"
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
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: spacing.sm,
  },
  body: { color: colors.text, fontSize: 13, lineHeight: 19 },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  feedback: { color: colors.primary, fontSize: 12, textAlign: 'center' },
});
