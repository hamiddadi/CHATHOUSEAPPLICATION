import React, { memo, useCallback } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Avatar } from '../../../../shared/components/Avatar';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { RoomParticipant } from '../../../../shared/types/domain';
import { useDismissHand, useKickFromRoom, useSetMute, useSetRole } from '../../hooks/useRooms';

interface HostActionsSheetProps {
  /** Visible only when a target participant is selected. `null` = closed. */
  target: RoomParticipant | null;
  roomId: string;
  /** True when the *viewer* is the room host (not just a moderator). */
  viewerIsHost: boolean;
  onClose: () => void;
}

/**
 * Bottom-sheet modal exposing every host/moderator action against a single
 * participant: mute, demote to listener, promote to speaker/moderator/host,
 * and kick (with a 30-min default ban). Rendered only when `target` is set
 * — caller controls open/close by setting / clearing the target.
 */
export const HostActionsSheet: React.FC<HostActionsSheetProps> = memo(
  ({ target, roomId, viewerIsHost, onClose }) => {
    const setMute = useSetMute();
    const setRole = useSetRole();
    const kick = useKickFromRoom();
    const dismissHand = useDismissHand();

    const handleDismissHand = useCallback(() => {
      if (!target) return;
      dismissHand.mutate({ roomId, userId: target.id }, { onSettled: onClose });
    }, [dismissHand, onClose, roomId, target]);

    const handleMute = useCallback(() => {
      if (!target) return;
      setMute.mutate(
        { roomId, isMuted: target.audio !== 'muted', userId: target.id },
        { onSettled: onClose },
      );
    }, [onClose, roomId, setMute, target]);

    const handlePromote = useCallback(
      (role: 'SPEAKER' | 'MODERATOR' | 'LISTENER') => {
        if (!target) return;
        setRole.mutate({ roomId, userId: target.id, role }, { onSettled: onClose });
      },
      [onClose, roomId, setRole, target],
    );

    const handleTransferHost = useCallback(() => {
      if (!target) return;
      Alert.alert(
        'Transférer la room',
        `Donner le rôle d'hôte à @${target.username} ? Vous deviendrez speaker.`,
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Transférer',
            style: 'destructive',
            onPress: () =>
              setRole.mutate({ roomId, userId: target.id, role: 'HOST' }, { onSettled: onClose }),
          },
        ],
      );
    }, [onClose, roomId, setRole, target]);

    const handleKick = useCallback(() => {
      if (!target) return;
      Alert.alert(
        'Expulser cet utilisateur',
        `@${target.username} sera retiré de la room et banni 30 minutes.`,
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Expulser',
            style: 'destructive',
            onPress: () =>
              kick.mutate({ roomId, userId: target.id, banMinutes: 30 }, { onSettled: onClose }),
          },
        ],
      );
    }, [kick, onClose, roomId, target]);

    if (!target) return null;

    const isOnStage = target.role !== 'listener';
    const muted = target.audio === 'muted';

    return (
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fermer">
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Avatar
                uri={target.avatarUrl ?? undefined}
                name={target.displayName}
                sizeValue={48}
              />
              <View style={styles.headerText}>
                <Text style={styles.displayName}>{target.displayName}</Text>
                <Text style={styles.username}>@{target.username}</Text>
              </View>
            </View>

            {isOnStage && (
              <ActionRow
                icon={muted ? 'mic' : 'mic-off'}
                label={muted ? 'Réactiver son micro' : 'Couper son micro'}
                onPress={handleMute}
              />
            )}
            {!isOnStage && (
              <ActionRow
                icon="mic"
                label="Inviter à parler"
                onPress={() => handlePromote('SPEAKER')}
              />
            )}
            {!isOnStage && target.handRaised && (
              <ActionRow
                icon="do-not-disturb-on"
                label="Refuser la main"
                onPress={handleDismissHand}
              />
            )}
            {isOnStage && (
              <ActionRow
                icon="mic-off"
                label="Renvoyer dans le public"
                onPress={() => handlePromote('LISTENER')}
              />
            )}
            <ActionRow
              icon="shield"
              label="Nommer modérateur"
              onPress={() => handlePromote('MODERATOR')}
            />
            {viewerIsHost && (
              <ActionRow
                icon="star"
                label="Transférer le rôle d'hôte"
                onPress={handleTransferHost}
              />
            )}
            <ActionRow
              icon="block"
              label="Expulser (ban 30 min)"
              onPress={handleKick}
              destructive
            />
            <Pressable
              onPress={onClose}
              style={styles.cancel}
              accessibilityRole="button"
              accessibilityLabel="Annuler"
            >
              <Text style={styles.cancelLabel}>Annuler</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    );
  },
);
HostActionsSheet.displayName = 'HostActionsSheet';

interface ActionRowProps {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

const ActionRow: React.FC<ActionRowProps> = memo(
  ({ icon, label, onPress, destructive = false }) => (
    <Pressable
      onPress={onPress}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <MaterialIcons name={icon} size={22} color={destructive ? colors.danger : colors.text} />
      <Text style={[styles.rowLabel, destructive ? styles.rowLabelDanger : null]}>{label}</Text>
    </Pressable>
  ),
);
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
  headerText: { flex: 1 },
  displayName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  username: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: '500' },
  rowLabelDanger: { color: colors.danger },
  cancel: {
    marginTop: spacing.md,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  cancelLabel: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
});
