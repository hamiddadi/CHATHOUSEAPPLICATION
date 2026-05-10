import React, { memo, useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import {
  useNavigation,
  useRoute,
  type NavigationProp,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ExpoClipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../../../shared/components/Avatar';
import { Button } from '../../../../shared/components/Button';
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { RoomStackParamList, SettingsStackParamList } from '../../../../core/navigation/types';
import { CURRENT_USER } from '../../../../shared/mocks/users.mock';
import { useFollow, useMe, useProfile, useUnfollow } from '../../hooks/useProfile';
import { useBlock, useReport, useWave } from '../../../social/hooks/useSocial';
import type { ReportReason } from '../../../social/services/socialService';
import { useHouses } from '../../../houses/hooks/useHouses';
import { useMyRoomHistory } from '../../../rooms/hooks/useRooms';
import type { HouseSummary, RoomSummary } from '../../../../shared/types/domain';

type Route = RouteProp<SettingsStackParamList, 'Profile'>;

const BIO_TRUNCATE_LENGTH = 120;

const REPORT_REASONS: readonly ReportReason[] = [
  'spam',
  'harassment',
  'fake_profile',
  'other',
] as const;

const Stat: React.FC<{ label: string; value: string; onPress?: () => void }> = memo(
  ({ label, value, onPress }) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${value} ${label}`}
      className="items-center px-md"
    >
      <Text className="text-xl font-display text-ink">{value}</Text>
      <Text className="text-xxs font-body text-ink-muted uppercase tracking-wider">{label}</Text>
    </Pressable>
  ),
);
Stat.displayName = 'Stat';

const formatCount = (n: number): string => {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
};

interface HouseRowProps {
  house: HouseSummary;
  onPress: (id: string) => void;
}

const HouseRow: React.FC<HouseRowProps> = memo(({ house, onPress }) => {
  const handle = useCallback(() => onPress(house.id), [house.id, onPress]);
  return (
    <Pressable
      onPress={handle}
      accessibilityRole="button"
      accessibilityLabel={house.name}
      className="flex-row items-center gap-md py-sm"
    >
      <View className="w-10 h-10 rounded-md bg-surface-container items-center justify-center">
        <Text className="text-lg">{house.categoryEmoji}</Text>
      </View>
      <View className="flex-1 gap-xxs">
        <Text className="text-md font-body-medium text-ink" numberOfLines={1}>
          {house.name}
        </Text>
        <Text className="text-xs text-ink-muted" numberOfLines={1}>
          {house.membersCount} members · {house.privacy}
        </Text>
      </View>
      <MaterialIcons name="chevron-right" size={18} color={colors.textMuted} />
    </Pressable>
  );
});
HouseRow.displayName = 'HouseRow';

interface HistoryRowProps {
  room: RoomSummary;
  onPress: (id: string) => void;
}

const HistoryRow: React.FC<HistoryRowProps> = memo(({ room, onPress }) => {
  const handle = useCallback(() => onPress(room.id), [onPress, room.id]);
  return (
    <Pressable
      onPress={handle}
      accessibilityRole="button"
      accessibilityLabel={room.title}
      className="flex-row items-center gap-md py-sm"
    >
      <View className="w-10 h-10 rounded-md bg-surface-container items-center justify-center">
        <Text className="text-lg">{room.categoryEmoji}</Text>
      </View>
      <View className="flex-1 gap-xxs">
        <Text className="text-md font-body-medium text-ink" numberOfLines={1}>
          {room.title}
        </Text>
        <Text className="text-xs text-ink-muted" numberOfLines={1}>
          {room.speakersCount} speakers · {room.listenersCount} listeners
        </Text>
      </View>
      <MaterialIcons name="chevron-right" size={18} color={colors.textMuted} />
    </Pressable>
  );
});
HistoryRow.displayName = 'HistoryRow';

export const ProfileScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp<SettingsStackParamList>>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const meQuery = useMe();
  const userId = route.params?.userId ?? meQuery.data?.id ?? CURRENT_USER.id;
  const isSelf = userId === (meQuery.data?.id ?? CURRENT_USER.id);

  const { data: user, isLoading, isError } = useProfile(userId);
  const follow = useFollow();
  const unfollow = useUnfollow();
  const wave = useWave();
  const block = useBlock();
  const report = useReport();

  const [bioExpanded, setBioExpanded] = useState(false);

  // Self-only sections: "Mes Houses" + "Rooms récentes". Hooks always
  // fire (React rule) but the render gates them on `isSelf`.
  const myHouses = useHouses('mine');
  const roomHistory = useMyRoomHistory(10);
  const roomStackNav = useNavigation<NavigationProp<RoomStackParamList>>();

  const goEdit = useCallback(() => navigation.navigate('EditProfile'), [navigation]);

  const handleCopyUsername = useCallback(async () => {
    if (!user?.username) return;
    await ExpoClipboard.setStringAsync(`@${user.username}`);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert(t('profile.copied'), t('profile.usernameCopied'));
  }, [t, user?.username]);

  const goHouseList = useCallback(() => roomStackNav.navigate('HouseList'), [roomStackNav]);
  const goHouseDetail = useCallback(
    (houseId: string) => roomStackNav.navigate('HouseDetail', { houseId }),
    [roomStackNav],
  );
  const goRoom = useCallback(
    (roomId: string) => roomStackNav.navigate('Room', { roomId }),
    [roomStackNav],
  );

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);
  const handleToggleFollow = useCallback(() => {
    if (!user) return;
    if (user.isFollowedByMe) unfollow.mutate(user.id);
    else follow.mutate(user.id);
  }, [follow, unfollow, user]);
  const handleShare = useCallback(async () => {
    if (!user) return;
    const handle = user.username ? `@${user.username}` : user.displayName;
    const url = `https://app.chathouse.com/u/${user.username ?? user.id}`;
    try {
      await Share.share({
        title: handle,
        message: `${handle} sur Chathouse — ${url}`,
        url,
      });
    } catch {
      /* user cancelled — no-op */
    }
  }, [user]);

  const handleWave = useCallback(() => {
    if (!user) return;
    wave.mutate(user.id, {
      onSuccess: () => Alert.alert(t('profile.waveSent')),
      onError: (err: unknown) => {
        const code =
          err && typeof err === 'object' && 'response' in err
            ? ((err as { response?: { data?: { error?: { code?: string } } } }).response?.data
                ?.error?.code ?? '')
            : '';
        // Backend returns USER_005 when the waver pinged this user in
        // the last hour — surface a friendlier copy instead of the raw
        // HTTP toast.
        if (code === 'USER_005') Alert.alert(t('profile.waveRateLimited'));
      },
    });
  }, [t, user, wave]);

  const submitReport = useCallback(
    (reason: ReportReason) => {
      if (!user) return;
      report.mutate(
        { userId: user.id, input: { reason } },
        {
          onSuccess: () => Alert.alert(t('profile.reportThanks')),
        },
      );
    },
    [report, t, user],
  );

  const handleReport = useCallback(() => {
    if (!user) return;
    Alert.alert(
      t('profile.reportTitle', { handle: user.username }),
      t('profile.reportReason'),
      [
        ...REPORT_REASONS.map(r => ({
          text: t(`profile.reasons.${r}`),
          onPress: () => submitReport(r),
        })),
        { text: t('profile.cancel'), style: 'cancel' as const },
      ],
      { cancelable: true },
    );
  }, [submitReport, t, user]);

  const handleBlock = useCallback(() => {
    if (!user) return;
    Alert.alert(
      t('profile.blockConfirmTitle', { handle: user.username }),
      t('profile.blockConfirmBody'),
      [
        { text: t('profile.cancel'), style: 'cancel' },
        {
          text: t('profile.blockConfirm'),
          style: 'destructive',
          onPress: () => block.mutate(user.id),
        },
      ],
      { cancelable: true },
    );
  }, [block, t, user]);

  const handleMore = useCallback(() => {
    if (!user) return;
    Alert.alert(
      t('profile.more'),
      user.username ? `@${user.username}` : undefined,
      [
        { text: t('profile.block'), style: 'destructive', onPress: handleBlock },
        { text: t('profile.report'), onPress: handleReport },
        { text: t('profile.cancel'), style: 'cancel' },
      ],
      { cancelable: true },
    );
  }, [handleBlock, handleReport, t, user]);

  if (isLoading) return <Loader fullscreen accessibilityLabel="Loading profile" />;
  if (isError || !user) {
    return <EmptyState title="Profile unavailable" description="This user may not exist." />;
  }

  const bio = user.bio ?? '';
  const isBioLong = bio.length > BIO_TRUNCATE_LENGTH;
  const displayBio = bioExpanded || !isBioLong ? bio : `${bio.slice(0, BIO_TRUNCATE_LENGTH)}...`;

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
        <View className="flex-row items-center gap-md">
          {isSelf && (
            <Pressable
              onPress={goEdit}
              accessibilityRole="button"
              accessibilityLabel={t('profile.editProfile')}
              hitSlop={8}
            >
              <MaterialIcons name="edit" size={22} color={colors.text} />
            </Pressable>
          )}
          <Pressable
            onPress={handleShare}
            accessibilityRole="button"
            accessibilityLabel="Share profile"
            hitSlop={8}
          >
            <MaterialIcons name="share" size={22} color={colors.text} />
          </Pressable>
          {!isSelf && (
            <Pressable
              onPress={handleMore}
              accessibilityRole="button"
              accessibilityLabel={t('profile.more')}
              hitSlop={8}
            >
              <MaterialIcons name="more-horiz" size={24} color={colors.text} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: spacing.xxl,
          paddingBottom: insets.bottom + spacing.giant,
          gap: spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View className="items-center gap-md">
          <Avatar
            uri={user.avatarUrl ?? undefined}
            name={user.displayName}
            sizeValue={120}
            status={user.isOnline ? 'online' : 'none'}
          />
          <View className="items-center gap-xxs">
            <Text className="text-xxxl font-display text-ink tracking-tight">
              {user.displayName}
            </Text>
            <Pressable
              onPress={handleCopyUsername}
              accessibilityRole="button"
              className="active:opacity-60"
            >
              <Text className="text-sm font-body text-ink-muted">@{user.username}</Text>
            </Pressable>
          </View>

          {bio.length > 0 && (
            <View className="items-center gap-xs">
              <Text className="text-sm font-body text-ink text-center leading-normal">
                {displayBio}
              </Text>
              {isBioLong && (
                <Pressable onPress={() => setBioExpanded(!bioExpanded)}>
                  <Text className="text-xs font-body-bold text-primary">
                    {bioExpanded ? t('profile.seeLess') : t('profile.seeMore')}
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          <View className="flex-row items-center mt-sm">
            <Stat label="Following" value={formatCount(user.followingCount)} />
            <View className="w-px h-[24px] bg-overlay-white-10" />
            <Stat label="Followers" value={formatCount(user.followersCount)} />
          </View>

          {!isSelf && (
            <View className="flex-row items-center gap-sm mt-md w-full">
              <View className="flex-1">
                <Button
                  label={user.isFollowedByMe ? 'Following' : 'Follow'}
                  variant={user.isFollowedByMe ? 'ghost' : 'primary'}
                  size="md"
                  fullWidth
                  loading={follow.isPending || unfollow.isPending}
                  onPress={handleToggleFollow}
                />
              </View>
              <Pressable
                onPress={handleWave}
                accessibilityRole="button"
                accessibilityLabel={t('profile.wave')}
                disabled={wave.isPending}
                className="w-11 h-11 rounded-pill bg-overlay-white-10 items-center justify-center"
              >
                <Text className="text-lg">🌊</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                className="w-11 h-11 rounded-pill bg-overlay-white-10 items-center justify-center"
              >
                <MaterialIcons name="chat-bubble-outline" size={18} color={colors.text} />
              </Pressable>
            </View>
          )}
        </View>

        {isSelf && (
          <View className="gap-xl mt-xl">
            <View className="gap-sm">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-body-bold text-ink-muted uppercase tracking-wider">
                  {t('profile.myHouses')}
                </Text>
                {(myHouses.data?.length ?? 0) > 0 && (
                  <Pressable onPress={goHouseList} accessibilityRole="button" hitSlop={8}>
                    <Text className="text-xs font-body-bold text-primary">
                      {t('profile.seeAll')}
                    </Text>
                  </Pressable>
                )}
              </View>
              {myHouses.isLoading ? (
                <Text className="text-xs text-ink-dim">…</Text>
              ) : !myHouses.data || myHouses.data.length === 0 ? (
                <Text className="text-sm text-ink-dim">{t('profile.emptyMyHouses')}</Text>
              ) : (
                myHouses.data
                  .slice(0, 5)
                  .map(h => <HouseRow key={h.id} house={h} onPress={goHouseDetail} />)
              )}
            </View>

            <View className="gap-sm">
              <Text className="text-sm font-body-bold text-ink-muted uppercase tracking-wider">
                {t('profile.recentRooms')}
              </Text>
              {roomHistory.isLoading ? (
                <Text className="text-xs text-ink-dim">…</Text>
              ) : !roomHistory.data || roomHistory.data.length === 0 ? (
                <Text className="text-sm text-ink-dim">{t('profile.emptyRecentRooms')}</Text>
              ) : (
                roomHistory.data.map(r => <HistoryRow key={r.id} room={r} onPress={goRoom} />)
              )}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
};
