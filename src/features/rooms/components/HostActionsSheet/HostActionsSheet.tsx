import React, { memo, useCallback, useRef } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../../../shared/components/Avatar';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { RoomParticipant } from '../../../../shared/types/domain';
import { errorMessage } from '../../../../shared/utils/errorMessage';
import { useKickFromRoom, useSetMute, useSetRole } from '../../hooks/useRooms';
import { speakInviteApi } from '../../../extensions';

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
    const { t } = useTranslation();
    const setMute = useSetMute();
    const setRole = useSetRole();
    const kick = useKickFromRoom();
    // #86: speak-invite REQUEST (the invitee accepts/refuses) — distinct from
    // the direct force-promote above.
    const nominate = useMutation({
      mutationFn: (userId: string) => speakInviteApi.invite(roomId, userId),
    });
    const actionInFlight = useRef(false);
    const isPending =
      setMute.isPending || setRole.isPending || kick.isPending || nominate.isPending;

    // TanStack updates `isPending` on the next render. The ref closes the small
    // window in which a fast double-tap could otherwise dispatch twice.
    const beginAction = useCallback(() => {
      if (actionInFlight.current || isPending) return false;
      actionInFlight.current = true;
      return true;
    }, [isPending]);

    const closeAfterSuccess = useCallback(() => {
      actionInFlight.current = false;
      onClose();
    }, [onClose]);

    const handleActionError = useCallback(
      (error: unknown) => {
        actionInFlight.current = false;
        Alert.alert(
          t('common.error', 'Something went wrong'),
          errorMessage(error, t('common.actionFailed', 'Action failed. Please try again.')),
        );
      },
      [t],
    );

    const handleClose = useCallback(() => {
      if (!actionInFlight.current && !isPending) onClose();
    }, [isPending, onClose]);

    const handleNominate = useCallback(() => {
      if (!target || !beginAction()) return;
      nominate.mutate(target.id, {
        onSuccess: () => {
          closeAfterSuccess();
          Alert.alert(
            t('room.hostActions.inviteSentTitle'),
            t('room.hostActions.inviteSentBody', {
              handle: target.username || target.displayName,
            }),
          );
        },
        onError: handleActionError,
      });
    }, [beginAction, closeAfterSuccess, handleActionError, nominate, t, target]);

    const handleMute = useCallback(() => {
      if (!target || !beginAction()) return;
      setMute.mutate(
        { roomId, isMuted: target.audio !== 'muted', userId: target.id },
        { onSuccess: closeAfterSuccess, onError: handleActionError },
      );
    }, [beginAction, closeAfterSuccess, handleActionError, roomId, setMute, target]);

    const handlePromote = useCallback(
      (role: 'SPEAKER' | 'MODERATOR' | 'LISTENER') => {
        if (!target || !beginAction()) return;
        setRole.mutate(
          { roomId, userId: target.id, role },
          { onSuccess: closeAfterSuccess, onError: handleActionError },
        );
      },
      [beginAction, closeAfterSuccess, handleActionError, roomId, setRole, target],
    );

    const handleTransferHost = useCallback(() => {
      if (!target || actionInFlight.current || isPending) return;
      Alert.alert(
        t('room.hostActions.transferTitle'),
        t('room.hostActions.transferBody', {
          handle: target.username || target.displayName,
        }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('room.hostActions.transferConfirm'),
            style: 'destructive',
            onPress: () => {
              if (!beginAction()) return;
              setRole.mutate(
                { roomId, userId: target.id, role: 'HOST' },
                { onSuccess: closeAfterSuccess, onError: handleActionError },
              );
            },
          },
        ],
      );
    }, [beginAction, closeAfterSuccess, handleActionError, isPending, roomId, setRole, t, target]);

    const handleKick = useCallback(() => {
      if (!target || actionInFlight.current || isPending) return;
      Alert.alert(
        t('room.hostActions.kickTitle'),
        t('room.hostActions.kickBody', {
          handle: target.username || target.displayName,
        }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('room.hostActions.kickConfirm'),
            style: 'destructive',
            onPress: () => {
              if (!beginAction()) return;
              kick.mutate(
                { roomId, userId: target.id, banMinutes: 30 },
                { onSuccess: closeAfterSuccess, onError: handleActionError },
              );
            },
          },
        ],
      );
    }, [beginAction, closeAfterSuccess, handleActionError, isPending, kick, roomId, t, target]);

    if (!target) return null;

    const isOnStage = target.role !== 'listener';
    const muted = target.audio === 'muted';

    return (
      <Modal visible transparent animationType="slide" onRequestClose={handleClose}>
        <Pressable style={styles.backdrop} onPress={handleClose} accessible={false}>
          <Pressable
            style={styles.sheet}
            onPress={() => undefined}
            accessible={false}
            accessibilityViewIsModal
            importantForAccessibility="yes"
          >
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
                label={
                  muted
                    ? t('room.hostActions.unmuteParticipant')
                    : t('room.hostActions.muteParticipant')
                }
                onPress={handleMute}
                disabled={isPending}
              />
            )}
            {!isOnStage && (
              <ActionRow
                icon="mic"
                label={t('room.hostActions.promoteSpeaker')}
                onPress={() => handlePromote('SPEAKER')}
                disabled={isPending}
              />
            )}
            {!isOnStage && (
              <ActionRow
                icon="record-voice-over"
                label={t('room.hostActions.nominateSpeaker')}
                onPress={handleNominate}
                disabled={isPending}
              />
            )}
            {isOnStage && (
              <ActionRow
                icon="mic-off"
                label={t('room.hostActions.moveToAudience')}
                onPress={() => handlePromote('LISTENER')}
                disabled={isPending}
              />
            )}
            <ActionRow
              icon="shield"
              label={t('room.hostActions.makeModerator')}
              onPress={() => handlePromote('MODERATOR')}
              disabled={isPending}
            />
            {viewerIsHost && (
              <ActionRow
                icon="star"
                label={t('room.hostActions.transferHost')}
                onPress={handleTransferHost}
                disabled={isPending}
              />
            )}
            <ActionRow
              icon="block"
              label={t('room.hostActions.kickBan')}
              onPress={handleKick}
              destructive
              disabled={isPending}
            />
            <Pressable
              onPress={handleClose}
              style={[styles.cancel, isPending ? styles.disabled : null]}
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
              accessibilityState={{ disabled: isPending }}
              disabled={isPending}
            >
              <Text style={styles.cancelLabel}>{t('common.cancel')}</Text>
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
  disabled?: boolean;
}

const ActionRow: React.FC<ActionRowProps> = memo(
  ({ icon, label, onPress, destructive = false, disabled = false }) => (
    <Pressable
      onPress={onPress}
      style={[styles.row, disabled ? styles.disabled : null]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
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
  disabled: { opacity: 0.45 },
  cancel: {
    marginTop: spacing.md,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  cancelLabel: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
});
