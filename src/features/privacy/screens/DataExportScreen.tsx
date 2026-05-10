import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../../shared/components/Button';
import { colors, spacing } from '../../../shared/constants/theme';
import { privacyService } from '../services/privacyService';

const SHARE_LIMIT = 50_000; // chars — Share sheet truncates anyway

export const DataExportScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [lastBytes, setLastBytes] = useState<number | null>(null);

  const handleExport = useCallback(async () => {
    setBusy(true);
    try {
      const json = await privacyService.exportMyData();
      setLastBytes(json.length);
      await Clipboard.setStringAsync(json);
      // Truncate the share-sheet payload — the full archive is in the
      // clipboard, the share message is just a preview/handoff.
      const message =
        json.length > SHARE_LIMIT
          ? `${json.slice(0, SHARE_LIMIT)}\n…(tronqué — le fichier complet est dans le presse-papier)`
          : json;
      await Share.share({ message, title: 'Mon export Chathouse (RGPD)' });
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec de l’export');
    } finally {
      setBusy(false);
    }
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
          graphe d&apos;abonnements, vos messages directs, vos messages de room, vos RSVP, vos
          tokens d&apos;appareils et vos préférences de notification.
        </Text>
        <Text style={styles.muted}>
          Note : le journal d&apos;audit (actions de modération) et les signalements émis contre
          votre compte ne sont pas inclus, conformément à l&apos;article 23 du RGPD (intérêt
          légitime de modération).
        </Text>
      </View>

      <Button
        label={busy ? 'Préparation…' : 'Générer mon export'}
        variant="primary"
        size="lg"
        fullWidth
        loading={busy}
        onPress={handleExport}
      />

      {lastBytes !== null ? (
        <Text style={styles.feedback}>
          ✓ Export généré ({(lastBytes / 1024).toFixed(1)} Ko) — copié dans le presse-papier.
        </Text>
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
