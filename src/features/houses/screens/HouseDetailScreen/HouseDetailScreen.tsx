import React, { useCallback, useMemo } from 'react';
import { Alert, FlatList, Pressable, Share, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../../../shared/components/Avatar';
import { Button } from '../../../../shared/components/Button';
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import { errorMessage } from '../../../../shared/utils/errorMessage';
import { useAuthStore } from '../../../auth/store/authStore';
import type { HouseMember } from '../../../../shared/types/domain';
import type { HouseMemberRole, HouseRoom } from '../../services/houseService';
import { useHouse, useHouseRooms, useJoinHouse, useSetMemberRole } from '../../hooks/useHouses';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'HouseDetail'>;
type Route = RouteProp<RoomStackParamList, 'HouseDetail'>;

const ROLE_LABEL: Record<HouseMemberRole, string> = {
  admin: 'Admin',
  moderator: 'Modérateur',
  member: 'Membre',
};

export const HouseDetailScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const houseId = route.params.houseId;
  const { data: house, isLoading, isError } = useHouse(houseId);
  const { data: liveRooms } = useHouseRooms(houseId, 'live');
  const { data: upcomingRooms } = useHouseRooms(houseId, 'upcoming');
  const setMemberRole = useSetMemberRole();
  const joinHouse = useJoinHouse();

  const viewerId = useAuthStore(s => s.user?.id ?? null);

  // The viewer can manage roles when they are an admin of this house. (The
  // owner is always materialised as an ADMIN member server-side.)
  const canManageRoles = useMemo(
    () =>
      !!viewerId && (house?.members.some(m => m.id === viewerId && m.role === 'admin') ?? false),
    [house?.members, viewerId],
  );

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);
  const handleInvite = useCallback(
    () => navigation.navigate('InviteMember', { houseId }),
    [navigation, houseId],
  );
  const handleJoin = useCallback(() => {
    joinHouse.mutate(houseId, {
      onError: e => Alert.alert('Erreur', errorMessage(e, 'Impossible de rejoindre cette house.')),
    });
  }, [houseId, joinHouse]);

  const handleOptions = useCallback(() => {
    const shareUrl = `https://app.chathouse.com/h/${houseId}`;
    Alert.alert('Options de la house', undefined, [
      {
        text: 'Partager la house',
        onPress: () => {
          void Share.share({
            title: 'Chathouse',
            message: `Découvre cette house sur Chathouse — ${shareUrl}`,
            url: shareUrl,
          }).catch(() => undefined);
        },
      },
      {
        text: 'Inviter des membres',
        onPress: handleInvite,
      },
      { text: 'Annuler', style: 'cancel' },
    ]);
  }, [handleInvite, houseId]);

  const applyRole = useCallback(
    (userId: string, role: HouseMemberRole) => {
      setMemberRole.mutate(
        { houseId, userId, role },
        {
          onError: () =>
            Alert.alert('Action impossible', 'Impossible de modifier le rôle de ce membre.'),
        },
      );
    },
    [houseId, setMemberRole],
  );

  const handleManageMember = useCallback(
    (member: HouseMember) => {
      // Offer every role except the one the member already holds.
      const options: { text: string; onPress: () => void }[] = (
        ['admin', 'moderator', 'member'] as HouseMemberRole[]
      )
        .filter(role => role !== member.role)
        .map(role => ({
          text: role === 'member' ? 'Rétrograder en Membre' : `Promouvoir ${ROLE_LABEL[role]}`,
          onPress: () => applyRole(member.id, role),
        }));
      Alert.alert(member.displayName, `Rôle actuel : ${ROLE_LABEL[member.role]}`, [
        ...options,
        { text: 'Annuler', style: 'cancel' },
      ]);
    },
    [applyRole],
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
    ({ item: m }: { item: HouseMember }) => {
      const manageable = isManageable(m);
      const row = (
        <>
          <Avatar uri={m.avatarUrl ?? undefined} name={m.displayName} size="md" />
          <View className="flex-1">
            <Text className="text-md font-body-bold text-ink">{m.displayName}</Text>
            <Text className="text-xs font-body text-ink-muted capitalize">{m.role}</Text>
          </View>
          {m.role !== 'member' && (
            <View className="bg-accent-container px-sm py-xxs rounded-xs">
              <Text className="text-xxs font-body-bold text-accent uppercase">{m.role}</Text>
            </View>
          )}
          {manageable && <MaterialIcons name="more-horiz" size={20} color={colors.textMuted} />}
        </>
      );
      return manageable ? (
        <Pressable
          onPress={() => handleManageMember(m)}
          disabled={setMemberRole.isPending}
          accessibilityRole="button"
          accessibilityLabel={`Manage role for ${m.displayName}`}
          className="flex-row items-center gap-md p-md rounded-md bg-overlay-white-5"
        >
          {row}
        </Pressable>
      ) : (
        <View className="flex-row items-center gap-md p-md rounded-md bg-overlay-white-5">
          {row}
        </View>
      );
    },
    [handleManageMember, isManageable, setMemberRole.isPending],
  );

  if (isLoading) return <Loader fullscreen accessibilityLabel="Loading house" />;
  if (isError || !house) {
    return <EmptyState title="House unavailable" description="This house may have been deleted." />;
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
            accessibilityLabel={`Open room ${room.title}`}
            className="flex-row items-center gap-md p-md rounded-md bg-overlay-white-5"
          >
            <View className={`h-2 w-2 rounded-full ${live ? 'bg-success' : 'bg-ink-muted'}`} />
            <View className="flex-1">
              <Text className="text-md font-body-bold text-ink" numberOfLines={1}>
                {room.title}
              </Text>
              <Text className="text-xs font-body text-ink-muted">
                {live
                  ? `${room.participantCount} en ligne`
                  : room.scheduledFor
                    ? new Date(room.scheduledFor).toLocaleString()
                    : 'Planifiée'}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} />
          </Pressable>
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
          accessibilityLabel="Back"
          hitSlop={8}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Pressable
          onPress={handleOptions}
          accessibilityRole="button"
          accessibilityLabel="House options"
          hitSlop={8}
        >
          <MaterialIcons name="more-vert" size={24} color={colors.text} />
        </Pressable>
      </View>

      <FlatList
        className="flex-1"
        data={house.members}
        keyExtractor={memberKeyExtractor}
        renderItem={renderMemberItem}
        contentContainerStyle={{
          paddingHorizontal: spacing.xxl,
          paddingBottom: insets.bottom + spacing.giant,
          gap: spacing.md,
        }}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListHeaderComponent={
          <View style={{ gap: spacing.xl }}>
            <View className="items-center gap-md">
              <Avatar
                uri={house.iconUrl ?? undefined}
                name={house.name}
                sizeValue={96}
                shape="squircle"
              />
              <Text className="text-display font-display text-ink tracking-tight">
                {house.name}
              </Text>
              <Text className="text-sm font-body text-ink-muted text-center">
                {house.description}
              </Text>
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
                <Button
                  label={t('house.inviteMembers', 'Invite members')}
                  variant="primaryContainer"
                  size="md"
                  onPress={handleInvite}
                />
              ) : house.privacy === 'private' ? (
                <Text className="text-xs font-body text-ink-muted">
                  {t('house.inviteOnly', 'Sur invitation uniquement')}
                </Text>
              ) : (
                <Button
                  label={t('house.join', 'Rejoindre')}
                  variant="primary"
                  size="md"
                  loading={joinHouse.isPending}
                  disabled={joinHouse.isPending}
                  onPress={handleJoin}
                />
              )}
            </View>

            {renderRoomSection(t('house.liveRooms', 'En direct'), liveRooms, true)}
            {renderRoomSection(t('house.upcomingRooms', 'Planifiées'), upcomingRooms, false)}

            <Text className="text-xxs font-body-bold text-ink-muted tracking-widest uppercase mt-lg">
              {t('house.membersList', 'Members')}
            </Text>
          </View>
        }
      />
    </View>
  );
};
