import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../../../shared/components/Avatar';
import { colors, spacing } from '../../../../shared/constants/theme';
import { apiClient } from '../../../../shared/services/api/apiClient';
import { usePingUserToRoom } from '../../hooks/useRooms';
import { messageService } from '../../../messages/services/messageService';
import { socialService, type ReportReason } from '../../../social/services/socialService';
import { errorMessage } from '../../../../shared/utils/errorMessage';
import type { UserSummary } from '../../../../shared/types/domain';
import { SHARE_BASE_URL } from '../../../../core/navigation/linking';
import { useExtBackend } from '../../../extensions/hooks/useExtBackend';
import { ExtTipSheet } from '../../../extensions/components/ExtTipSheet';
import { areExternalDigitalPurchasesAllowed } from '../../../extensions/utils/digitalPurchases';
import { ProfileReportSheet } from '../../../social/components/ProfileReportSheet';
import { createIdempotencyKey } from '../../../../shared/utils/idempotency';
import { profileService } from '../../../profile/services/profileService';
import { retryTransientMutation } from '../../../../shared/services/api/retryPolicy';

// Follow uses the typed profile service so private-account request state is
// retained. Wave remains a small direct REST call until it joins that service.
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
  /** Optional: open a 1:1 DM thread with this participant. */
  onMessage?: (userId: string) => void;
}

/**
 * Lightweight read-only action sheet shown when a non-mod taps a
 * participant's avatar. Exposes the social verbs every Clubhouse-like app
 * exposes from a room: follow / open profile / ping to come back / wave /
 * report. Distinct from `HostActionsSheet` which is the moderation
 * surface (kick / mute / promote).
 */
export const ProfileActionSheet: React.FC<ProfileActionSheetProps> = memo(
  ({ target, roomId, viewerId, onClose, onOpenProfile, onMessage }) => {
    const { t } = useTranslation();
    const follow = useMutation({ mutationFn: profileService.follow });
    const ping = usePingUserToRoom();
    const wave = useMutation({ mutationFn: realWave });
    const block = useMutation({ mutationFn: socialService.block });
    const report = useMutation({
      mutationFn: ({ userId, reason }: { userId: string; reason: ReportReason }) =>
        socialService.report(userId, { reason }),
    });
    // #112: post the room link as a DM so the participant can hop in from chat.
    const shareDm = useMutation({
      mutationFn: ({ userId, idempotencyKey }: { userId: string; idempotencyKey: string }) =>
        messageService.send(
          userId,
          t('room.shareDmMessage', { url: `${SHARE_BASE_URL}/room/${roomId}` }),
          idempotencyKey,
        ),
      retry: retryTransientMutation,
    });
    const { status: extStatus } = useExtBackend();
    const externalPurchasesAllowed = areExternalDigitalPurchasesAllowed();
    const [tipping, setTipping] = useState(false);
    const [reportVisible, setReportVisible] = useState(false);
    const shareInFlightRef = useRef(false);
    useEffect(() => {
      if (!target) setReportVisible(false);
    }, [target]);
    const handleTip = useCallback(() => setTipping(true), []);
    const handleTipClose = useCallback(() => setTipping(false), []);
    const handleTipSent = useCallback(() => {
      setTipping(false);
      onClose();
    }, [onClose]);

    const handleFollow = useCallback(() => {
      if (!target) return;
      follow.mutate(target.id, {
        onSuccess: result => {
          Alert.alert(
            result.requested
              ? t('room.profileActions.requestedTitle')
              : t('room.profileActions.followedTitle'),
            t(
              result.requested
                ? 'room.profileActions.requestedBody'
                : 'room.profileActions.followedBody',
              { handle: target.username ?? target.displayName },
            ),
          );
          onClose();
        },
        onError: e => Alert.alert(t('common.error'), errorMessage(e, t('common.actionFailed'))),
      });
    }, [follow, onClose, t, target]);

    const handlePing = useCallback(() => {
      if (!target) return;
      ping.mutate(
        { targetUserId: target.id, roomId },
        {
          onSuccess: () => {
            Alert.alert(
              t('room.profileActions.pingSentTitle'),
              t('room.profileActions.pingSentBody', {
                handle: target.username ?? target.displayName,
              }),
            );
            onClose();
          },
          onError: e => Alert.alert(t('common.error'), errorMessage(e, t('common.actionFailed'))),
        },
      );
    }, [onClose, ping, roomId, t, target]);

    const handleWave = useCallback(() => {
      if (!target) return;
      wave.mutate(target.id, {
        onSuccess: () => onClose(),
        onError: e => Alert.alert(t('common.error'), errorMessage(e, t('common.actionFailed'))),
      });
    }, [onClose, t, target, wave]);

    const handleOpenProfile = useCallback(() => {
      if (!target || !onOpenProfile) return;
      onOpenProfile(target.id);
      onClose();
    }, [onClose, onOpenProfile, target]);

    const handleMessage = useCallback(() => {
      if (!target || !onMessage) return;
      onMessage(target.id);
      onClose();
    }, [onClose, onMessage, target]);

    const handleShareRoom = useCallback(async () => {
      if (!target || shareInFlightRef.current) return;
      shareInFlightRef.current = true;
      try {
        await shareDm.mutateAsync({
          userId: target.id,
          idempotencyKey: createIdempotencyKey(),
        });
        Alert.alert(
          t('room.shareSentTitle'),
          t('room.shareSentBody', { handle: target.username ?? target.displayName }),
        );
        onClose();
      } catch (e) {
        Alert.alert(t('common.error'), errorMessage(e, t('common.actionFailed')));
      } finally {
        shareInFlightRef.current = false;
      }
    }, [onClose, shareDm, t, target]);

    const handleBlock = useCallback(() => {
      if (!target) return;
      const handle = target.username ?? target.displayName;
      Alert.alert(
        t('profile.blockConfirmTitle', { handle: `@${handle}` }),
        t('room.profileActions.blockBody'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('profile.blockConfirm'),
            style: 'destructive',
            onPress: () =>
              block.mutate(target.id, {
                onSuccess: () => onClose(),
                onError: e =>
                  Alert.alert(t('common.error'), errorMessage(e, t('common.actionFailed'))),
              }),
          },
        ],
        { cancelable: true },
      );
    }, [block, onClose, t, target]);

    const handleReport = useCallback(() => setReportVisible(true), []);
    const handleReportReason = useCallback(
      (reason: ReportReason) => {
        if (!target || report.isPending) return;
        report.mutate(
          { userId: target.id, reason },
          {
            onSuccess: () => {
              setReportVisible(false);
              Alert.alert(t('room.profileActions.reportSentTitle'), t('profile.reportThanks'));
              onClose();
            },
            onError: e => Alert.alert(t('common.error'), errorMessage(e, t('common.actionFailed'))),
          },
        );
      },
      [onClose, report, t, target],
    );

    if (!target) return null;
    const isSelf = viewerId === target.id;

    return (
      <>
        <Modal visible={!reportVisible} transparent animationType="slide" onRequestClose={onClose}>
          <Pressable style={styles.backdrop} onPress={onClose} accessible={false}>
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
                  <ActionRow icon="person-add" label={t('profile.follow')} onPress={handleFollow} />
                  {onMessage ? (
                    <ActionRow
                      icon="chat"
                      label={t('room.profileActions.message')}
                      onPress={handleMessage}
                    />
                  ) : null}
                  <ActionRow
                    icon="notifications"
                    label={t('room.profileActions.ping')}
                    onPress={handlePing}
                  />
                  <ActionRow
                    icon="waves"
                    label={t('room.profileActions.wave')}
                    onPress={handleWave}
                  />
                  <ActionRow
                    icon="share"
                    label={t('room.shareRoomAction')}
                    onPress={handleShareRoom}
                  />
                  {extStatus.features.payments && externalPurchasesAllowed ? (
                    <ActionRow
                      icon="volunteer-activism"
                      label={t('room.profileActions.tip')}
                      onPress={handleTip}
                    />
                  ) : null}
                  {onOpenProfile ? (
                    <ActionRow
                      icon="person"
                      label={t('room.profileActions.openProfile')}
                      onPress={handleOpenProfile}
                    />
                  ) : null}
                  <ActionRow
                    icon="flag"
                    label={t('room.profileActions.report')}
                    onPress={handleReport}
                  />
                  <ActionRow
                    icon="block"
                    label={t('room.profileActions.block')}
                    onPress={handleBlock}
                  />
                </>
              ) : (
                <Text style={styles.selfNote}>{t('room.profileActions.self')}</Text>
              )}
              <Pressable
                onPress={onClose}
                style={styles.cancel}
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
              >
                <Text style={styles.cancelLabel}>{t('common.cancel')}</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
        <ProfileReportSheet
          visible={reportVisible}
          targetLabel={`@${target.username ?? target.displayName}`}
          submitting={report.isPending}
          onClose={() => setReportVisible(false)}
          onSelect={handleReportReason}
        />
        <ExtTipSheet
          target={externalPurchasesAllowed && tipping ? target : null}
          onClose={handleTipClose}
          onSent={handleTipSent}
        />
      </>
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
    backgroundColor: colors.modalBackdrop,
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
    backgroundColor: colors.glass,
  },
  cancelLabel: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  headerInfo: { flex: 1 },
});
