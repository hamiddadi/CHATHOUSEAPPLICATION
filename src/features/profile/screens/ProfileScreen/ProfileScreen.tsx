import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, Share, View } from 'react-native';
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
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { spacing } from '../../../../shared/constants/theme';
import type { RoomStackParamList, SettingsStackParamList } from '../../../../core/navigation/types';
import { useAuthStore } from '../../../auth/store/authStore';
import { useFollow, useMe, useProfile, useUnfollow } from '../../hooks/useProfile';
import { useBlock, useReport, useWave } from '../../../social/hooks/useSocial';
import type { ReportReason } from '../../../social/services/socialService';
import { useHouses } from '../../../houses/hooks/useHouses';
import { useMyRoomHistory } from '../../../rooms/hooks/useRooms';
import ProfileHeaderBar from './partials/ProfileHeaderBar';
import ProfileIdentity from './partials/ProfileIdentity';
import ProfileStats from './partials/ProfileStats';
import ProfileActionButtons from './partials/ProfileActionButtons';
import SelfSections from './partials/SelfSections';

type Route = RouteProp<SettingsStackParamList, 'Profile'>;

const BIO_TRUNCATE_LENGTH = 120;

const REPORT_REASONS: readonly ReportReason[] = [
  'spam',
  'harassment',
  'fake_profile',
  'other',
] as const;

export const ProfileScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp<SettingsStackParamList>>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const meQuery = useMe();
  // Resolve the viewer's real id from the auth store (falling back to the
  // freshly fetched `me` query) instead of the mock CURRENT_USER. When no
  // route param is given and we don't yet know who "me" is, `userId` stays
  // empty and the screen renders a Loader below.
  const myId = useAuthStore(s => s.user?.id) ?? meQuery.data?.id;
  const userId = route.params?.userId ?? myId ?? '';
  const isSelf = !!myId && userId === myId;

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
    // Surface follow/unfollow failures: the hook re-syncs the cache on
    // error, but without this the button gives no feedback on a network
    // failure (mirrors EditProfileScreen's save-error Alert).
    const onError = (): void => Alert.alert('Error', 'Action failed. Please try again.');
    if (user.isFollowedByMe) unfollow.mutate(user.id, { onError });
    else follow.mutate(user.id, { onError });
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

  // No route param and the viewer's id isn't known yet (auth store still
  // hydrating): the detail query is disabled, so wait rather than fall
  // through to the "unavailable" empty state.
  if (userId.length === 0 || isLoading) {
    return <Loader fullscreen accessibilityLabel="Loading profile" />;
  }
  if (isError || !user) {
    return <EmptyState title="Profile unavailable" description="This user may not exist." />;
  }

  const bio = user.bio ?? '';
  const isBioLong = bio.length > BIO_TRUNCATE_LENGTH;
  const displayBio = bioExpanded || !isBioLong ? bio : `${bio.slice(0, BIO_TRUNCATE_LENGTH)}...`;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <ProfileHeaderBar
        isSelf={isSelf}
        onBack={handleBack}
        onEdit={goEdit}
        onShare={handleShare}
        onMore={handleMore}
      />

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
          <ProfileIdentity
            avatarUrl={user.avatarUrl}
            displayName={user.displayName}
            firstName={user.firstName}
            lastName={user.lastName}
            username={user.username}
            joinedAt={user.createdAt}
            invitedByUsername={user.invitedBy?.username}
            isOnline={user.isOnline}
            bio={bio}
            displayBio={displayBio}
            isBioLong={isBioLong}
            bioExpanded={bioExpanded}
            twitter={user.twitter}
            instagram={user.instagram}
            onCopyUsername={handleCopyUsername}
            onToggleBio={() => setBioExpanded(!bioExpanded)}
          />

          <ProfileStats followingCount={user.followingCount} followersCount={user.followersCount} />

          {!isSelf && (
            <ProfileActionButtons
              isFollowedByMe={user.isFollowedByMe}
              followLoading={follow.isPending || unfollow.isPending}
              waveLoading={wave.isPending}
              onToggleFollow={handleToggleFollow}
              onWave={handleWave}
            />
          )}
        </View>

        {isSelf && (
          <SelfSections
            houses={myHouses.data}
            housesLoading={myHouses.isLoading}
            rooms={roomHistory.data}
            roomsLoading={roomHistory.isLoading}
            onSeeAllHouses={goHouseList}
            onHousePress={goHouseDetail}
            onRoomPress={goRoom}
          />
        )}
      </ScrollView>
    </View>
  );
};
