import React, { memo, useCallback } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '../../../../shared/constants/theme';
import { errorMessage } from '../../../../shared/utils/errorMessage';
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
    const { t } = useTranslation();
    const muteAll = useMuteAllInRoom();
    const toggleChat = useToggleRoomChat();

    const handleMuteAll = useCallback(() => {
      Alert.alert(t('roomControls.muteAll'), t('roomControls.muteAllBody'), [
        { text: t('roomControls.cancel'), style: 'cancel' },
        {
          text: t('roomControls.confirm'),
          style: 'destructive',
          onPress: () =>
            muteAll.mutate(
              { roomId, includeHost: false },
              {
                onSuccess: r =>
                  Alert.alert(
                    t('roomControls.done'),
                    t('roomControls.muteAllDone', { count: r.mutedCount }),
                  ),
                onError: e =>
                  Alert.alert(t('roomControls.error'), errorMessage(e, t('roomControls.failed'))),
              },
            ),
        },
      ]);
    }, [muteAll, roomId, t]);

    const handleToggleChatEnabled = useCallback(() => {
      toggleChat.mutate(
        { roomId, chatEnabled: !chatEnabled },
        {
          onError: e =>
            Alert.alert(t('roomControls.error'), errorMessage(e, t('roomControls.failed'))),
        },
      );
    }, [chatEnabled, roomId, toggleChat, t]);

    const handleToggleChatVisibility = useCallback(() => {
      toggleChat.mutate(
        { roomId, chatVisibility: chatVisibility === 'MODS_ONLY' ? 'all' : 'mods' },
        {
          onError: e =>
            Alert.alert(t('roomControls.error'), errorMessage(e, t('roomControls.failed'))),
        },
      );
    }, [chatVisibility, roomId, toggleChat, t]);

    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityLabel={t('roomControls.close')}
        >
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <View style={styles.handle} />
            <Text style={styles.title}>{t('roomControls.title')}</Text>

            <Row
              icon="title"
              label={t('roomControls.editTitle')}
              onPress={() => {
                onClose();
                onEditTitle();
              }}
            />
            <Row
              icon="person-add"
              label={t('roomControls.invite')}
              onPress={() => {
                onClose();
                onInvite();
              }}
            />
            <Row
              icon="volume-off"
              label={t('roomControls.muteAll')}
              onPress={handleMuteAll}
              destructive
            />
            <Row
              icon={chatEnabled ? 'chat' : 'chat-bubble-outline'}
              label={chatEnabled ? t('roomControls.disableChat') : t('roomControls.enableChat')}
              onPress={handleToggleChatEnabled}
            />
            <Row
              icon={chatVisibility === 'MODS_ONLY' ? 'visibility' : 'visibility-off'}
              label={
                chatVisibility === 'MODS_ONLY'
                  ? t('roomControls.chatVisibleAll')
                  : t('roomControls.chatModsOnly')
              }
              onPress={handleToggleChatVisibility}
            />

            <Pressable
              onPress={onClose}
              style={styles.cancel}
              accessibilityRole="button"
              accessibilityLabel={t('roomControls.close')}
            >
              <Text style={styles.cancelLabel}>{t('roomControls.close')}</Text>
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
