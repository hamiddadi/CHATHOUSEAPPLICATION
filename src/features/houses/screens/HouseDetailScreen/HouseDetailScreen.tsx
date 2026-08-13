import React, { memo, useCallback, useMemo } from 'react';
import { Alert, FlatList, Image, Pressable, Share, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useExtJoinHouse,
  clubReqApi,
  clubMetaApi,
  type ClubJoinRequest,
} from '@/features/extensions';
import { Avatar } from '../../../../shared/components/Avatar';
import { Button } from '../../../../shared/components/Button';
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import { SHARE_BASE_URL } from '../../../../core/navigation/linking';
import { errorMessage } from '../../../../shared/utils/errorMessage';
import { useAuthStore } from '../../../auth/store/authStore';
import type { House, HouseMember } from '../../../../shared/types/domain';
import type { HouseMemberRole, HouseRoom } from '../../services/houseService';
import {
  houseKeys,
  useAcceptInvitation,
  useHouse,
  useHouseRooms,
  useJoinHouse,
  useLeaveHouse,
  useRemoveMember,
  useSetMemberRole,
} from '../../hooks/useHouses';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'HouseDetail'>;
type Route = RouteProp<RoomStackParamList, 'HouseDetail'>;

/**
 * Defensive read of the pending-invitation marker the detail API may expose
 * for an invited viewer of a PRIVATE house (`viewerInvite` / `pendingInvite`,
 * added server-side). Both the field and its shape are optional — absence
 * simply means "no pending invite" and the legacy "invite only" text shows.
 */
type ViewerInviteMarker = boolean | { token?: string; inviteToken?: string } | null;
type HouseWithInvite = House & {
  viewerInvite?: ViewerInviteMarker;
  pendingInvite?: ViewerInviteMarker;
};

interface MemberRowProps {
  member: HouseMember;
  manageable: boolean;
  disabled: boolean;
  onManage: (member: HouseMember) => void;
}

/** Memoised member row — the members FlatList re-renders on every house
 *  refetch, so keeping the row pure avoids re-rendering the whole list. */
const MemberRow: React.FC<MemberRowProps> = memo(
  ({ member: m, manageable, disabled, onManage }) => {
    const { t } = useTranslation();
    const handle = useCallback(() => onManage(m), [m, onManage]);
    const row = (
      <>
        <Avatar uri={m.avatarUrl ?? undefined} name={m.displayName} size="md" />
        <View className="flex-1">
          <Text className="text-md font-body-bold text-ink" numberOfLines={1}>
            {m.displayName}
          </Text>
          <Text className="text-xs font-body text-ink-muted capitalize">{m.role}</Text>
        </View>
        {m.role !== 'member' && (
          <View className="bg-accent-container px-sm py-xxs rounded-xs">
            <Text className="text-xxs font-body-bold text-accent-on-container uppercase">
              {m.role}
            </Text>
          </View>
        )}
        {manageable && <MaterialIcons name="more-horiz" size={20} color={colors.textMuted} />}
      </>
    );
    return manageable ? (
      <Pressable
        onPress={handle}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={t('house.manageMemberA11y', 'Manage role for {{name}}', {
          name: m.displayName,
        })}
        className="flex-row items-center gap-md p-md rounded-md bg-overlay-white-5"
      >
        {row}
      </Pressable>
    ) : (
      <View className="flex-row items-center gap-md p-md rounded-md bg-overlay-white-5">{row}</View>
    );
  },
);
MemberRow.displayName = 'MemberRow';

export const HouseDetailScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const houseId = route.params.houseId;
  const {
    data: house,
    isLoading,
    isError,
    isRefetching: houseRefetching,
    refetch: refetchHouse,
  } = useHouse(houseId);
  const { data: liveRooms, refetch: refetchLiveRooms } = useHouseRooms(houseId, 'live');
  const { data: upcomingRooms, refetch: refetchUpcomingRooms } = useHouseRooms(houseId, 'upcoming');
  const { data: pastRooms, refetch: refetchPastRooms } = useHouseRooms(houseId, 'past');
  const { data: clubMeta } = useQuery({
    queryKey: [...houseKeys.detail(houseId), 'meta'],
    queryFn: () => clubMetaApi.get(houseId),
    enabled: houseId.length > 0,
    staleTime: 60_000,
  });
  const setMemberRole = useSetMemberRole();
  const joinHouse = useJoinHouse();
  const leaveHouse = useLeaveHouse();
  const removeMember = useRemoveMember();
  const queryClient = useQueryClient();

  const viewerId = useAuthStore(s => s.user?.id ?? null);
  // The owner can't leave (backend CLUB_005) — they delete the house instead.
  const viewerIsOwner = !!viewerId && house?.ownerId === viewerId;

  // The viewer can manage roles when they are an admin of this house. (The
  // owner is always materialised as an ADMIN member server-side.)
  const canManageRoles = useMemo(
    () =>
      !!viewerId && (house?.members.some(m => m.id === viewerId && m.role === 'admin') ?? false),
    [house?.members, viewerId],
  );

  // Mirror of the backend invite gate (CLUB_002): only the owner or an
  // ADMIN/MODERATOR member may invite. Offering the CTA to anyone else just
  // funnels them into a guaranteed server rejection.
  const canInvite = useMemo(() => {
    if (!viewerId || !house) return false;
    if (house.ownerId === viewerId) return true;
    const me = house.members.find(m => m.id === viewerId);
    return me?.role === 'admin' || me?.role === 'moderator';
  }, [house, viewerId]);

  // Pending invitation for the viewer (PRIVATE houses) — see HouseWithInvite.
  const inviteMarker = useMemo<ViewerInviteMarker | undefined>(() => {
    if (!house) return undefined;
    const h = house as HouseWithInvite;
    return h.viewerInvite ?? h.pendingInvite;
  }, [house]);
  const hasPendingInvite = !!inviteMarker;
  const pendingInviteToken =
    typeof inviteMarker === 'object' && inviteMarker !== null
      ? (inviteMarker.token ?? inviteMarker.inviteToken)
      : undefined;

  const acceptInvitation = useAcceptInvitation();
  const handleAcceptInvite = useCallback(() => {
    acceptInvitation.mutate(
      { houseId, inviteToken: pendingInviteToken },
      {
        onError: e =>
          Alert.alert(
            t('house.actionErrorTitle', 'Action failed'),
            errorMessage(e, t('house.acceptInviteError', "Couldn't accept the invitation.")),
          ),
      },
    );
  }, [acceptInvitation, houseId, pendingInviteToken, t]);

  // The viewer (OWNER/ADMIN of a SOCIAL house) sees a pending-requests inbox.
  const isSocial = house?.privacy === 'social';
  const showRequestInbox = canManageRoles && isSocial;

  // SOCIAL request-to-join CTA. The clubreq flow returns 'joined' for OPEN
  // clubs (not used here) and 'pending' for SOCIAL; on 'joined' we refetch the
  // house so the membership-aware section flips to "Invite members".
  const refreshHouse = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: houseKeys.detail(houseId) });
  }, [queryClient, houseId]);
  const joinFlow = useExtJoinHouse({ onJoined: refreshHouse });
  const handleRequestToJoin = useCallback(() => {
    void joinFlow.join(houseId);
  }, [joinFlow, houseId]);

  // Pending join requests for the admin inbox (SOCIAL houses only). Skipped
  // entirely when the viewer can't manage the house or it isn't SOCIAL.
  const {
    data: joinRequests,
    isLoading: requestsLoading,
    refetch: refetchRequests,
  } = useQuery<ClubJoinRequest[]>({
    queryKey: [...houseKeys.detail(houseId), 'joinRequests'],
    queryFn: () => clubReqApi.list(houseId),
    enabled: showRequestInbox,
  });

  // After approve/decline: drop the handled request, refresh the house so the
  // members list / count reflect the new member, and re-pull the inbox.
  const onRequestSettled = useCallback(() => {
    void refetchRequests();
    void queryClient.invalidateQueries({ queryKey: houseKeys.detail(houseId) });
  }, [refetchRequests, queryClient, houseId]);

  const approveRequest = useMutation({
    mutationFn: (userId: string) => clubReqApi.approve(houseId, userId),
    onSuccess: onRequestSettled,
    onError: e =>
      Alert.alert(
        t('house.requests.errorTitle', 'Action impossible'),
        errorMessage(e, t('house.requests.approveError', "Impossible d'approuver cette demande.")),
      ),
  });
  const declineRequest = useMutation({
    mutationFn: (userId: string) => clubReqApi.decline(houseId, userId),
    onSuccess: onRequestSettled,
    onError: e =>
      Alert.alert(
        t('house.requests.errorTitle', 'Action impossible'),
        errorMessage(e, t('house.requests.declineError', 'Impossible de refuser cette demande.')),
      ),
  });
  const requestPending = approveRequest.isPending || declineRequest.isPending;

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);
  const handleInvite = useCallback(
    () => navigation.navigate('InviteMember', { houseId }),
    [navigation, houseId],
  );
  const handleManageHouse = useCallback(
    () => navigation.navigate('ManageHouse', { houseId }),
    [navigation, houseId],
  );
  const handleJoin = useCallback(() => {
    joinHouse.mutate(houseId, {
      onError: e =>
        Alert.alert(
          t('house.actionErrorTitle', 'Action failed'),
          errorMessage(e, t('house.joinError', "Couldn't join this house.")),
        ),
    });
  }, [houseId, joinHouse, t]);

  // Pull-to-refresh: re-pull the house AND its room bands in one gesture.
  const handleRefresh = useCallback(() => {
    void refetchHouse();
    void refetchLiveRooms();
    void refetchUpcomingRooms();
    void refetchPastRooms();
  }, [refetchHouse, refetchLiveRooms, refetchUpcomingRooms, refetchPastRooms]);

  const handleLeave = useCallback(() => {
    Alert.alert(
      t('house.leaveTitle', 'Leave the house'),
      t('house.leaveBody', 'You will no longer get its rooms and events.'),
      [
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
        {
          text: t('house.leaveConfirm', 'Leave'),
          style: 'destructive',
          onPress: () =>
            leaveHouse.mutate(houseId, {
              onSuccess: () => navigation.goBack(),
              onError: e =>
                Alert.alert(
                  t('house.actionErrorTitle', 'Action failed'),
                  errorMessage(e, t('house.leaveError', "Couldn't leave this house.")),
                ),
            }),
        },
      ],
    );
  }, [houseId, leaveHouse, navigation, t]);

  const handleOptions = useCallback(() => {
    // Must match the declared deep link (`house/:houseId` in linking.ts) so a
    // shared link actually opens the house. `…/h/<id>` was a dead URL.
    const shareUrl = `${SHARE_BASE_URL}/house/${houseId}`;
    const buttons: {
      text: string;
      style?: 'cancel' | 'destructive';
      onPress?: () => void;
    }[] = [
      {
        text: t('house.share', 'Share the house'),
        onPress: () => {
          void Share.share({
            title: 'ChatHouse',
            message: t('house.shareMessage', 'Check out this house on ChatHouse — {{url}}', {
              url: shareUrl,
            }),
            url: shareUrl,
          }).catch(() => undefined);
        },
      },
    ];
    // Inviting is gated by the backend (CLUB_002) to the owner / admins /
    // moderators — only offer it when the call can succeed.
    if (canInvite) {
      buttons.push({ text: t('house.inviteMembers', 'Invite members'), onPress: handleInvite });
    }
    // A member who isn't the owner can leave (the owner deletes instead).
    if (house?.isJoinedByMe && !viewerIsOwner) {
      buttons.push({
        text: t('house.leave', 'Leave the house'),
        style: 'destructive',
        onPress: handleLeave,
      });
    }
    buttons.push({ text: t('common.cancel', 'Cancel'), style: 'cancel' });
    Alert.alert(t('house.optionsTitle', 'House options'), undefined, buttons);
  }, [canInvite, handleInvite, houseId, house?.isJoinedByMe, viewerIsOwner, handleLeave, t]);

  const applyRole = useCallback(
    (userId: string, role: HouseMemberRole) => {
      setMemberRole.mutate(
        { houseId, userId, role },
        {
          onError: e =>
            Alert.alert(
              t('house.actionErrorTitle', 'Action failed'),
              errorMessage(e, t('house.roleError', "Couldn't change this member's role.")),
            ),
        },
      );
    },
    [houseId, setMemberRole, t],
  );

  // Kick is destructive and irreversible from this screen — always route
  // through an explicit confirmation Alert before firing the mutation.
  const confirmKick = useCallback(
    (member: HouseMember) => {
      Alert.alert(
        t('house.kickConfirmTitle', 'Remove {{name}}?', { name: member.displayName }),
        t('house.kickConfirmBody', 'They will lose access to this house and its rooms.'),
        [
          { text: t('common.cancel', 'Cancel'), style: 'cancel' },
          {
            text: t('house.kickConfirm', 'Remove'),
            style: 'destructive',
            onPress: () =>
              removeMember.mutate(
                { houseId, userId: member.id },
                {
                  onError: e =>
                    Alert.alert(
                      t('house.actionErrorTitle', 'Action failed'),
                      errorMessage(e, t('house.kickError', "Couldn't remove this member.")),
                    ),
                },
              ),
          },
        ],
      );
    },
    [houseId, removeMember, t],
  );

  const roleLabels: Record<HouseMemberRole, string> = useMemo(
    () => ({
      admin: t('house.roles.admin', 'Admin'),
      moderator: t('house.roles.moderator', 'Moderator'),
      member: t('house.roles.member', 'Member'),
    }),
    [t],
  );

  const handleManageMember = useCallback(
    (member: HouseMember) => {
      // Offer every role except the one the member already holds.
      const options: { text: string; onPress: () => void }[] = (
        ['admin', 'moderator', 'member'] as HouseMemberRole[]
      )
        .filter(role => role !== member.role)
        .map(role => ({
          text:
            role === 'member'
              ? t('house.demoteToMember', 'Demote to Member')
              : t('house.promoteTo', 'Promote to {{role}}', { role: roleLabels[role] }),
          onPress: () => applyRole(member.id, role),
        }));
      Alert.alert(
        member.displayName,
        t('house.currentRole', 'Current role: {{role}}', { role: roleLabels[member.role] }),
        [
          ...options,
          {
            text: t('house.kick', 'Remove from house'),
            style: 'destructive',
            onPress: () => confirmKick(member),
          },
          { text: t('common.cancel', 'Cancel'), style: 'cancel' },
        ],
      );
    },
    [applyRole, confirmKick, roleLabels, t],
  );

  // Admins can manage every member except themselves and the owner — the
  // backend rejects any role change targeting the owner, so offering it would
  // always fail. `house?.ownerId` distinguishes the owner from other admins.
  // Declared as hooks BEFORE the early returns below so the Rules of Hooks
  // hold (these previously lived after the loading/error guards — a violation).
  const isManageable = useCallback(
    (member: HouseMember): boolean =>
      canManageRoles && member.id !== viewerId && member.id !== house?.ownerId,
    [canManageRoles, viewerId, house?.ownerId],
  );

  const memberKeyExtractor = useCallback((item: HouseMember) => item.id, []);
  const renderMemberItem = useCallback(
    ({ item: m }: { item: HouseMember }) => (
      <MemberRow
        member={m}
        manageable={isManageable(m)}
        disabled={setMemberRole.isPending}
        onManage={handleManageMember}
      />
    ),
    [handleManageMember, isManageable, setMemberRole.isPending],
  );

  if (isLoading) {
    return <Loader fullscreen accessibilityLabel={t('house.loading', 'Loading house')} />;
  }
  if (isError || !house) {
    return (
      <EmptyState
        title={t('house.unavailableTitle', 'House unavailable')}
        description={t('house.unavailableBody', 'This house may have been deleted.')}
      />
    );
  }

  const renderRoomSection = (title: string, rooms: HouseRoom[] | undefined, live: boolean) => {
    if (!rooms || rooms.length === 0) return null;
    return (
      <View className="gap-md">
        <Text className="text-xxs font-body-bold text-ink-muted tracking-widest uppercase">
          {title}
        </Text>
        {rooms.map(room => (
          <Pressable
            key={room.id}
            onPress={() => navigation.navigate('Room', { roomId: room.id })}
            accessibilityRole="button"
            accessibilityLabel={t('house.openRoomA11y', 'Open room {{title}}', {
              title: room.title,
            })}
            className="flex-row items-center gap-md p-md rounded-md bg-overlay-white-5"
          >
            <View className={`h-2 w-2 rounded-full ${live ? 'bg-success' : 'bg-ink-muted'}`} />
            <View className="flex-1">
              <Text className="text-md font-body-bold text-ink" numberOfLines={1}>
                {room.title}
              </Text>
              <Text className="text-xs font-body text-ink-muted">
                {live
                  ? t('house.roomOnlineCount', '{{count}} online', {
                      count: room.participantCount,
                    })
                  : room.scheduledFor
                    ? new Date(room.scheduledFor).toLocaleString()
                    : t('house.roomScheduled', 'Scheduled')}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} />
          </Pressable>
        ))}
      </View>
    );
  };

  // Admin inbox: pending join requests for a SOCIAL house. Only rendered when
  // the viewer can manage the house and there is something to act on / load.
  const renderRequestInbox = () => {
    if (!showRequestInbox) return null;
    if (requestsLoading && !joinRequests) {
      return (
        <View className="gap-md">
          <Text className="text-xxs font-body-bold text-ink-muted tracking-widest uppercase">
            {t('house.requests.title', 'Pending requests')}
          </Text>
          <Loader accessibilityLabel={t('house.requests.loading', 'Loading join requests')} />
        </View>
      );
    }
    if (!joinRequests || joinRequests.length === 0) return null;
    return (
      <View className="gap-md">
        <Text className="text-xxs font-body-bold text-ink-muted tracking-widest uppercase">
          {t('house.requests.title', 'Pending requests')}
        </Text>
        {joinRequests.map(req => (
          <View
            key={req.userId}
            className="flex-row items-center gap-md p-md rounded-md bg-overlay-white-5"
          >
            <View className="flex-1">
              <Text className="text-md font-body-bold text-ink" numberOfLines={1}>
                {req.displayName ?? req.username ?? req.userId}
              </Text>
              {req.message ? (
                <Text className="text-xs font-body text-ink-muted" numberOfLines={2}>
                  {req.message}
                </Text>
              ) : null}
            </View>
            <Button
              label={t('house.requests.approve', 'Approve')}
              variant="primary"
              size="sm"
              disabled={requestPending}
              onPress={() => approveRequest.mutate(req.userId)}
            />
            <Button
              label={t('house.requests.decline', 'Decline')}
              variant="ghost"
              size="sm"
              disabled={requestPending}
              onPress={() => declineRequest.mutate(req.userId)}
            />
          </View>
        ))}
      </View>
    );
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-xxl py-lg">
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', 'Back')}
          // 24px icon + 2×10 hitSlop = 44px touch target.
          hitSlop={10}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <View className="flex-row items-center gap-lg">
          {canManageRoles && (
            <Pressable
              onPress={handleManageHouse}
              accessibilityRole="button"
              accessibilityLabel={t('house.manageA11y', 'Manage house')}
              hitSlop={8}
            >
              <MaterialIcons name="settings" size={24} color={colors.text} />
            </Pressable>
          )}
          <Pressable
            onPress={handleOptions}
            accessibilityRole="button"
            accessibilityLabel={t('house.optionsA11y', 'House options')}
            hitSlop={8}
          >
            <MaterialIcons name="more-vert" size={24} color={colors.text} />
          </Pressable>
        </View>
      </View>

      <FlatList
        className="flex-1"
        data={house.members}
        keyExtractor={memberKeyExtractor}
        renderItem={renderMemberItem}
        refreshing={houseRefetching}
        onRefresh={handleRefresh}
        contentContainerStyle={{
          paddingHorizontal: spacing.xxl,
          paddingBottom: insets.bottom + spacing.giant,
          gap: spacing.md,
        }}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListHeaderComponent={
          <View style={{ gap: spacing.xl }}>
            {clubMeta?.coverUrl ? (
              <Image
                source={{ uri: clubMeta.coverUrl }}
                className="w-full h-[120px] rounded-md"
                resizeMode="cover"
                accessibilityIgnoresInvertColors
              />
            ) : null}
            <View className="items-center gap-md">
              <Avatar
                uri={house.iconUrl ?? undefined}
                name={house.name}
                sizeValue={96}
                shape="squircle"
              />
              <Text
                className="text-display font-display text-ink tracking-tight text-center"
                numberOfLines={2}
              >
                {house.name}
              </Text>
              <Text className="text-sm font-body text-ink-muted text-center">
                {house.description}
              </Text>
              {house.rules ? (
                <View className="self-stretch gap-xs">
                  <Text className="text-xxs font-body-bold text-ink-muted tracking-widest uppercase">
                    {t('house.rules', 'Rules')}
                  </Text>
                  <Text className="text-sm font-body text-ink-muted">{house.rules}</Text>
                </View>
              ) : null}
              <View className="flex-row items-center gap-xxl">
                <View className="items-center">
                  <Text className="text-xl font-display text-ink">
                    {house.membersCount.toLocaleString()}
                  </Text>
                  <Text className="text-xs font-body text-ink-muted">
                    {t('house.members', 'members')}
                  </Text>
                </View>
                <View className="items-center">
                  <Text className="text-xl font-display text-ink">{house.liveRoomsCount}</Text>
                  <Text className="text-xs font-body text-ink-muted">
                    {t('house.roomsLive', 'rooms live')}
                  </Text>
                </View>
              </View>
              {house.isJoinedByMe ? (
                // The invite CTA mirrors the backend CLUB_002 gate: owner /
                // admin / moderator only. A plain member sees no CTA here.
                canInvite ? (
                  <Button
                    label={t('house.inviteMembers', 'Invite members')}
                    variant="primaryContainer"
                    size="md"
                    onPress={handleInvite}
                  />
                ) : null
              ) : house.privacy === 'private' ? (
                hasPendingInvite ? (
                  // Invited viewer of a PRIVATE house: surface the accept CTA
                  // instead of the "invite only" dead-end.
                  <Button
                    label={t('house.acceptInvite', 'Accept invitation')}
                    variant="primary"
                    size="md"
                    loading={acceptInvitation.isPending}
                    disabled={acceptInvitation.isPending}
                    onPress={handleAcceptInvite}
                  />
                ) : (
                  <Text className="text-xs font-body text-ink-muted">
                    {t('house.inviteOnly', 'Invite only')}
                  </Text>
                )
              ) : house.privacy === 'social' ? (
                // SOCIAL houses are approval-gated: the legacy direct join now
                // rejects them (CLUB-01), so route through the clubreq request
                // flow. The CTA flips to "Request sent" once a request is queued.
                <Button
                  label={
                    joinFlow.isPending
                      ? t('house.requestSent', 'Request sent')
                      : t('house.requestToJoin', 'Request to join')
                  }
                  variant="primary"
                  size="md"
                  loading={joinFlow.isSubmitting}
                  disabled={joinFlow.isSubmitting || joinFlow.isPending}
                  onPress={handleRequestToJoin}
                />
              ) : (
                <Button
                  label={t('house.join', 'Join')}
                  variant="primary"
                  size="md"
                  loading={joinHouse.isPending}
                  disabled={joinHouse.isPending}
                  onPress={handleJoin}
                />
              )}
            </View>

            {renderRequestInbox()}

            {renderRoomSection(t('house.liveRooms', 'Live now'), liveRooms, true)}
            {renderRoomSection(t('house.upcomingRooms', 'Scheduled'), upcomingRooms, false)}
            {renderRoomSection(t('house.pastRooms', 'Past rooms'), pastRooms, false)}

            <Text className="text-xxs font-body-bold text-ink-muted tracking-widest uppercase mt-lg">
              {t('house.membersList', 'Members')}
            </Text>
          </View>
        }
      />
    </View>
  );
};
