import React, { memo, useCallback } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors, spacing } from '../../../../shared/constants/theme';
import { useMuteAllInRoom, useToggleRoomChat } from '../../hooks/useRooms';

interface RoomControlsSheetProps {
  visible: boolean;
  roomId: string;
  chatEnabled: boolean;
  chatVisibility: 'ALL' | 'MODS_ONLY';
  onClose: () => void;
  onEditTitle: () => void;
  onInvite: () => void;
}

/**
 * Host/moderator-only sheet exposing room-level controls (mute all,
 * toggle chat, change visibility, edit title, invite).  Distinct from
 * `HostActionsSheet` which targets a single participant.
 */
export const RoomControlsSheet: React.FC<RoomControlsSheetProps> = memo(
  ({ visible, roomId, chatEnabled, chatVisibility, onClose, onEditTitle, onInvite }) => {
    const muteAll = useMuteAllInRoom();
    const toggleChat = useToggleRoomChat();

    const handleMuteAll = useCallback(() => {
      Alert.alert(
        'Mute tous les speakers',
        'Tous les speakers (hors host) seront mutés. Ils pourront se réactiver eux-mêmes.',
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Confirmer',
            style: 'destructive',
            onPress: () =>
              muteAll.mutate(
                { roomId, includeHost: false },
                {
                  onSuccess: r => Alert.alert('Fait', `${r.mutedCount} speaker(s) muté(s).`),
                  onError: e => Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec'),
                },
              ),
          },
        ],
      );
    }, [muteAll, roomId]);

    const handleToggleChatEnabled = useCallback(() => {
      toggleChat.mutate(
        { roomId, chatEnabled: !chatEnabled },
        {
          onError: e => Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec'),
        },
      );
    }, [chatEnabled, roomId, toggleChat]);

    const handleToggleChatVisibility = useCallback(() => {
      toggleChat.mutate(
        { roomId, chatVisibility: chatVisibility === 'MODS_ONLY' ? 'all' : 'mods' },
        {
          onError: e => Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec'),
        },
      );
    }, [chatVisibility, roomId, toggleChat]);

    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fermer">
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <View style={styles.handle} />
            <Text style={styles.title}>Contrôles de la room</Text>

            <Row
              icon="title"
              label="Modifier le titre"
              onPress={() => {
                onClose();
                onEditTitle();
              }}
            />
            <Row
              icon="person-add"
              label="Inviter des followers"
              onPress={() => {
                onClose();
                onInvite();
              }}
            />
            <Row
              icon="volume-off"
              label="Mute tous les speakers"
              onPress={handleMuteAll}
              destructive
            />
            <Row
              icon={chatEnabled ? 'chat' : 'chat-bubble-outline'}
              label={chatEnabled ? 'Désactiver le chat' : 'Activer le chat'}
              onPress={handleToggleChatEnabled}
            />
            <Row
              icon={chatVisibility === 'MODS_ONLY' ? 'visibility' : 'visibility-off'}
              label={
                chatVisibility === 'MODS_ONLY'
                  ? 'Rendre le chat visible à tous'
                  : 'Limiter le chat aux modérateurs'
              }
              onPress={handleToggleChatVisibility}
            />

            <Pressable
              onPress={onClose}
              style={styles.cancel}
              accessibilityRole="button"
              accessibilityLabel="Fermer"
            >
              <Text style={styles.cancelLabel}>Fermer</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    );
  },
);
RoomControlsSheet.displayName = 'RoomControlsSheet';

const Row: React.FC<{
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  onPress: () => void;
  destructive?: boolean;
}> = memo(({ icon, label, onPress, destructive }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
    style={styles.row}
  >
    <MaterialIcons name={icon} size={22} color={destructive ? colors.danger : colors.text} />
    <Text style={[styles.rowLabel, destructive ? styles.rowLabelDanger : null]}>{label}</Text>
  </Pressable>
));
Row.displayName = 'Row';

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
    gap: spacing.xs,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
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
