import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../../shared/components/Button';
import { colors, spacing } from '../../../shared/constants/theme';
import { useAuthStore } from '../../auth/store/authStore';
import { privacyService } from '../services/privacyService';

const CONFIRM_PHRASE = 'SUPPRIMER';

export const DeleteAccountScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const signOut = useAuthStore(s => s.signOut);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const canDelete = confirm.trim().toUpperCase() === CONFIRM_PHRASE && !busy;

  const handleDelete = useCallback(() => {
    Alert.alert(
      'Confirmer la suppression',
      `Votre compte sera désactivé immédiatement et définitivement supprimé après 30 jours.\n\nVous serez déconnecté·e dès maintenant. Vous pouvez vous reconnecter dans les 30 jours pour annuler la suppression.\n\nContinuer ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await privacyService.requestDeletion();
              // Sign out clears tokens + push registration so the user can't
              // keep transacting with the now-soft-deleted account.
              await signOut();
            } catch (e) {
              Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }, [signOut]);

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
      <Text style={styles.h1}>Supprimer mon compte</Text>

      <View style={styles.warningCard}>
        <Text style={styles.warningTitle}>⚠️ Action quasi-irréversible</Text>
        <Text style={styles.warningBody}>
          Vous disposerez de 30 jours pour annuler la suppression en vous reconnectant. Passé ce
          délai, l&apos;intégralité de vos données sera purgée définitivement (hormis les journaux
          légalement requis pour la modération, conservés 1 an).
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Avant de supprimer</Text>
        <Text style={styles.body}>
          • Vous pouvez exporter vos données depuis Paramètres → Confidentialité → Exporter mes
          données.
        </Text>
        <Text style={styles.body}>
          • Les rooms que vous avez hébergées seront fermées si elles sont actives.
        </Text>
        <Text style={styles.body}>
          • Vos messages directs envoyés à d&apos;autres utilisateurs resteront visibles côté
          destinataire (impossible de les retirer après envoi).
        </Text>
      </View>

      <View>
        <Text style={styles.confirmLabel}>
          Pour confirmer, tapez <Text style={styles.confirmPhrase}>{CONFIRM_PHRASE}</Text>
        </Text>
        <TextInput
          value={confirm}
          onChangeText={setConfirm}
          placeholder={CONFIRM_PHRASE}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          style={styles.input}
          accessibilityLabel="Saisie de confirmation de suppression"
        />
      </View>

      <Button
        label={busy ? 'Suppression…' : 'Supprimer définitivement'}
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
  warningCard: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 12,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.4)',
    gap: spacing.sm,
  },
  warningTitle: { color: colors.danger, fontSize: 14, fontWeight: '700' },
  warningBody: { color: colors.text, fontSize: 13, lineHeight: 19 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 6,
  },
  cardTitle: { color: colors.text, fontSize: 13, fontWeight: '700', marginBottom: 4 },
  body: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  confirmLabel: { color: colors.text, fontSize: 13, marginBottom: spacing.sm },
  confirmPhrase: { color: colors.danger, fontWeight: '700' },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    color: colors.text,
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    fontSize: 15,
    letterSpacing: 1,
  },
});
