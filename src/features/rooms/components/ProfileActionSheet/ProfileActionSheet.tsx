import React, { memo, useCallback } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { Avatar } from '../../../../shared/components/Avatar';
import { colors, spacing } from '../../../../shared/constants/theme';
import { apiClient } from '../../../../shared/services/api/apiClient';
import { usePingUserToRoom } from '../../hooks/useRooms';
import { errorMessage } from '../../../../shared/utils/errorMessage';
import type { UserSummary } from '../../../../shared/types/domain';

// Direct REST shims — the existing `profileService.follow/wave` are
// in-memory mocks. We hit the real API here so taps actually mutate
// state. A later refactor can centralise these into a typed service.
const realFollow = (userId: string): Promise<unknown> =>
  apiClient.post(`/follow/${userId}`).then(r => r.data);
const realWave = (userId: string): Promise<unknown> =>
  apiClient.post(`/users/${userId}/wave`).then(r => r.data);

interface ProfileActionSheetProps {
  /** When null, the sheet is hidden. */
  target: UserSummary | null;
  roomId: string;
  /** Avoid showing self-actions when the viewer taps their own avatar. */
  viewerId: string | null;
  onClose: () => void;
  /** Optional: navigate to the full profile. */
  onOpenProfile?: (userId: string) => void;
}

/**
 * Lightweight read-only action sheet shown when a non-mod taps a
 * participant's avatar. Exposes the social verbs every Clubhouse-like app
 * exposes from a room: follow / open profile / ping to come back / wave /
 * report. Distinct from `HostActionsSheet` which is the moderation
 * surface (kick / mute / promote).
 */
export const ProfileActionSheet: React.FC<ProfileActionSheetProps> = memo(
  ({ target, roomId, viewerId, onClose, onOpenProfile }) => {
    const follow = useMutation({ mutationFn: realFollow });
    const ping = usePingUserToRoom();
    const wave = useMutation({ mutationFn: realWave });

    const handleFollow = useCallback(() => {
      if (!target) return;
      follow.mutate(target.id, {
        onSuccess: () => {
          Alert.alert('OK', `Vous suivez maintenant @${target.username ?? target.displayName}.`);
          onClose();
        },
        onError: e => Alert.alert('Erreur', errorMessage(e, 'Échec')),
      });
    }, [follow, onClose, target]);

    const handlePing = useCallback(() => {
      if (!target) return;
      ping.mutate(
        { targetUserId: target.id, roomId },
        {
          onSuccess: () => {
            Alert.alert(
              'Ping envoyé',
              `@${target.username ?? target.displayName} reçoit une notification.`,
            );
            onClose();
          },
          onError: e => Alert.alert('Erreur', errorMessage(e, 'Échec')),
        },
      );
    }, [onClose, ping, roomId, target]);

    const handleWave = useCallback(() => {
      if (!target) return;
      wave.mutate(target.id, {
        onSuccess: () => onClose(),
        onError: e => Alert.alert('Erreur', errorMessage(e, 'Échec')),
      });
    }, [onClose, target, wave]);

    const handleOpenProfile = useCallback(() => {
      if (!target || !onOpenProfile) return;
      onOpenProfile(target.id);
      onClose();
    }, [onClose, onOpenProfile, target]);

    if (!target) return null;
    const isSelf = viewerId === target.id;

    return (
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fermer">
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Avatar
                uri={target.avatarUrl ?? undefined}
                name={target.displayName ?? target.username ?? '?'}
                sizeValue={56}
              />
              <View style={styles.headerInfo}>
                <Text style={styles.name}>{target.displayName ?? target.username ?? '—'}</Text>
                <Text style={styles.username}>@{target.username ?? '—'}</Text>
              </View>
            </View>

            {!isSelf ? (
              <>
                <ActionRow icon="person-add" label="Suivre" onPress={handleFollow} />
                <ActionRow icon="notifications" label="Ping (rejoins-moi)" onPress={handlePing} />
                <ActionRow icon="waves" label="Envoyer un wave 🌊" onPress={handleWave} />
                {onOpenProfile ? (
                  <ActionRow
                    icon="person"
                    label="Voir le profil complet"
                    onPress={handleOpenProfile}
                  />
                ) : null}
              </>
            ) : (
              <Text style={styles.selfNote}>C&apos;est vous 👋</Text>
            )}
            <Pressable
              onPress={onClose}
              style={styles.cancel}
              accessibilityRole="button"
              accessibilityLabel="Fermer"
            >
              <Text style={styles.cancelLabel}>Annuler</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    );
  },
);
ProfileActionSheet.displayName = 'ProfileActionSheet';

const ActionRow: React.FC<{
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  onPress: () => void;
}> = memo(({ icon, label, onPress }) => (
  <Pressable
    onPress={onPress}
    style={styles.row}
    accessibilityRole="button"
    accessibilityLabel={label}
  >
    <MaterialIcons name={icon} size={22} color={colors.text} />
    <Text style={styles.rowLabel}>{label}</Text>
  </Pressable>
));
ActionRow.displayName = 'ActionRow';

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surfaceHigh,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.xxl,
    gap: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    marginBottom: spacing.sm,
  },
  name: { color: colors.text, fontSize: 18, fontWeight: '700' },
  username: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: '500' },
  selfNote: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  cancel: {
    marginTop: spacing.md,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  cancelLabel: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  headerInfo: { flex: 1 },
});
