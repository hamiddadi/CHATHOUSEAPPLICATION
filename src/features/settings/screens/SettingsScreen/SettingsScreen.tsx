import React, { memo, useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../auth/store/authStore';
import { useMe } from '../../../profile/hooks/useProfile';
import { useHouses } from '../../../houses/hooks/useHouses';
import { DEFAULTS } from '../../../../shared/constants/images';
import { colors, layout, radii, spacing } from '../../../../shared/constants/theme';
import type { SettingsStackScreenProps } from '../../../../core/navigation/types';
import type { HouseSummary } from '../../../../shared/types/domain';

type Nav = SettingsStackScreenProps<'Settings'>['navigation'];

const HERO_HEIGHT = 192;
const AVATAR_SIZE = 96;
const AVATAR_BORDER = 4;
const BIO_LINE_LIMIT = 4;
const CLUBS_TILE_COUNT = 4;

const HERO_GRADIENT = ['#0c112e', '#2f3f92', '#070b28'] as const;
const PRIMARY_GRADIENT = ['#b0c6ff', '#558dff'] as const;
const ACCENT_GRADIENT = ['#558dff', '#0058ca'] as const;

const formatCount = (n: number): string => {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
};

interface StatProps {
  label: string;
  value: string;
  onPress?: () => void;
}

const Stat: React.FC<StatProps> = memo(({ label, value, onPress }) => (
  <Pressable
    onPress={onPress}
    disabled={!onPress}
    accessibilityRole={onPress ? 'button' : 'text'}
    accessibilityLabel={`${value} ${label}`}
    className="items-center"
  >
    <Text className="text-sm font-body-bold text-white">{value}</Text>
    <Text className="text-[10px] font-body-medium text-ink-muted uppercase tracking-wider mt-xxs">
      {label}
    </Text>
  </Pressable>
));
Stat.displayName = 'Stat';

interface HouseTileProps {
  house: HouseSummary;
  onPress: (id: string) => void;
}

const HouseTile: React.FC<HouseTileProps> = memo(({ house, onPress }) => {
  const handle = useCallback(() => onPress(house.id), [house.id, onPress]);
  return (
    <Pressable
      onPress={handle}
      accessibilityRole="button"
      accessibilityLabel={`Open ${house.name}`}
      style={styles.houseTile}
      className="bg-surface-low p-md rounded-md border border-overlay-white-5 flex-row items-center gap-sm"
    >
      <View className="w-10 h-10 rounded-sm bg-primary/20 items-center justify-center overflow-hidden">
        {house.iconUrl ? (
          <Image source={{ uri: house.iconUrl }} style={styles.houseIcon} contentFit="cover" />
        ) : (
          <Text className="text-md">{house.categoryEmoji}</Text>
        )}
      </View>
      <Text className="text-xs font-body-bold text-white leading-tight flex-1" numberOfLines={2}>
        {house.name}
      </Text>
    </Pressable>
  );
});
HouseTile.displayName = 'HouseTile';

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const signOut = useAuthStore(s => s.signOut);
  const { data: user } = useMe();
  const { data: myHouses } = useHouses('mine');
  const [bioExpanded, setBioExpanded] = useState(false);

  const houseTiles = useMemo(() => (myHouses ?? []).slice(0, CLUBS_TILE_COUNT), [myHouses]);
  const clubsCount = myHouses?.length ?? 0;

  const handleWave = useCallback(() => {
    // Wire to presence ping once realtime wave is shipped.
  }, []);

  const handleEditProfile = useCallback(() => navigation.navigate('EditProfile'), [navigation]);

  const handleToggleBio = useCallback(() => setBioExpanded(v => !v), []);

  const handleMore = useCallback(() => {
    Alert.alert('Account', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void signOut();
        },
      },
    ]);
  }, [signOut]);

  const handleCreateHouse = useCallback(() => {
    navigation.navigate('RoomsTab', { screen: 'CreateHouse' });
  }, [navigation]);

  const handleViewAllHouses = useCallback(() => {
    navigation.navigate('RoomsTab', { screen: 'HouseList' });
  }, [navigation]);

  const handleOpenHouse = useCallback(
    (houseId: string) => {
      navigation.navigate('RoomsTab', { screen: 'HouseDetail', params: { houseId } });
    },
    [navigation],
  );

  const handleFollowersTap = useCallback(() => {
    if (!user) return;
    navigation.navigate('Followers', { userId: user.id, initialTab: 'followers' });
  }, [navigation, user]);

  const handleFollowingTap = useCallback(() => {
    if (!user) return;
    navigation.navigate('Followers', { userId: user.id, initialTab: 'following' });
  }, [navigation, user]);

  return (
    <View className="flex-1 bg-background">
      <View
        pointerEvents="box-none"
        style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}
      >
        <View className="flex-row items-center gap-sm">
          <MaterialIcons name="graphic-eq" size={22} color={colors.primary} />
          <Text className="text-lg font-display text-primary tracking-tighter">Chathouse</Text>
        </View>
        <Pressable
          onPress={handleWave}
          accessibilityRole="button"
          accessibilityLabel="Send a wave"
          className="bg-primary/10 px-lg py-xs rounded-pill"
        >
          <Text className="text-sm font-body-bold text-primary">Wave 👋</Text>
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingBottom:
            insets.bottom + layout.tabBarHeight + layout.tabBarBottomOffset + spacing.huge,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <LinearGradient
            colors={HERO_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </View>
        <View style={styles.avatarWrapper} pointerEvents="box-none">
          <View style={styles.avatarRing}>
            <Image
              source={{ uri: user?.avatarUrl ?? DEFAULTS.avatar }}
              style={styles.avatarImage}
              contentFit="cover"
              transition={200}
              cachePolicy="memory-disk"
            />
          </View>
        </View>

        <View className="mt-[56px] items-center px-xxl">
          <Text className="text-xl font-display-bold text-white">
            {user?.displayName ?? 'Your profile'}
          </Text>
          <Text className="text-sm font-body-medium text-ink-muted mt-xxs">
            @{user?.username ?? 'username'}
          </Text>

          {user?.bio && (
            <View className="mt-md items-center">
              <Text
                className="text-sm font-body text-ink-muted text-center leading-relaxed"
                numberOfLines={bioExpanded ? undefined : BIO_LINE_LIMIT}
              >
                {user.bio}
              </Text>
              <Pressable
                onPress={handleToggleBio}
                accessibilityRole="button"
                accessibilityLabel={bioExpanded ? 'Collapse bio' : 'Expand bio'}
                hitSlop={8}
                className="mt-xxs"
              >
                <Text className="text-xs font-body-bold text-primary">
                  {bioExpanded ? 'See less' : 'See more'}
                </Text>
              </Pressable>
            </View>
          )}

          <View className="flex-row items-center gap-lg mt-lg">
            <Stat
              label="Followers"
              value={formatCount(user?.followersCount ?? 0)}
              onPress={handleFollowersTap}
            />
            <View style={styles.statDivider} />
            <Stat
              label="Following"
              value={formatCount(user?.followingCount ?? 0)}
              onPress={handleFollowingTap}
            />
            <View style={styles.statDivider} />
            <Stat label="Clubs" value={String(clubsCount)} />
          </View>

          <View className="flex-row items-center gap-sm mt-xl">
            <Pressable
              onPress={handleEditProfile}
              accessibilityRole="button"
              accessibilityLabel="Edit profile"
              className="rounded-pill overflow-hidden active:opacity-90"
            >
              <LinearGradient
                colors={PRIMARY_GRADIENT}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.primaryBtn}
              >
                <Text className="text-sm font-body-bold text-on-primary-container">
                  Edit profile
                </Text>
              </LinearGradient>
            </Pressable>
            <Pressable
              onPress={handleWave}
              accessibilityRole="button"
              accessibilityLabel="Wave to followers"
              className="border border-primary/30 rounded-pill px-xl py-sm active:opacity-80"
            >
              <Text className="text-sm font-body-bold text-primary">Wave 👋</Text>
            </Pressable>
            <Pressable
              onPress={handleMore}
              accessibilityRole="button"
              accessibilityLabel="More options"
              className="w-11 h-11 border border-primary/30 rounded-pill items-center justify-center active:opacity-80"
            >
              <MaterialIcons name="more-horiz" size={20} color={colors.primary} />
            </Pressable>
          </View>
        </View>

        <View className="px-xxl mt-[40px]">
          <Pressable
            onPress={handleCreateHouse}
            accessibilityRole="button"
            accessibilityLabel="Create a new house"
            className="rounded-pill overflow-hidden active:opacity-90"
          >
            <LinearGradient
              colors={ACCENT_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.createHouseBtn}
            >
              <MaterialIcons name="home-work" size={20} color="#FFFFFF" />
              <Text className="text-sm font-body-bold text-white ml-sm">Create House</Text>
            </LinearGradient>
          </Pressable>
        </View>

        <View className="px-xxl mt-xxl">
          <View className="flex-row items-center justify-between mb-md">
            <Text className="text-md font-display text-white">Member of</Text>
            <Pressable
              onPress={handleViewAllHouses}
              accessibilityRole="button"
              accessibilityLabel="View all houses"
              hitSlop={8}
            >
              <Text className="text-xs font-body-bold text-primary">View all</Text>
            </Pressable>
          </View>
          <View style={styles.housesGrid}>
            {houseTiles.map(h => (
              <HouseTile key={h.id} house={h} onPress={handleOpenHouse} />
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.sm,
    backgroundColor: 'rgba(7,11,40,0.35)',
  },
  hero: {
    width: '100%',
    height: HERO_HEIGHT,
    overflow: 'hidden',
  },
  avatarWrapper: {
    alignItems: 'center',
    marginTop: -AVATAR_SIZE / 2,
  },
  avatarRing: {
    width: AVATAR_SIZE + AVATAR_BORDER * 2,
    height: AVATAR_SIZE + AVATAR_BORDER * 2,
    borderRadius: (AVATAR_SIZE + AVATAR_BORDER * 2) / 2,
    borderWidth: AVATAR_BORDER,
    borderColor: colors.primary,
    backgroundColor: colors.surfaceHighest,
    overflow: 'hidden',
  },
  avatarImage: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  primaryBtn: {
    paddingHorizontal: spacing.xxxl,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createHouseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
  housesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  houseTile: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  houseIcon: {
    width: '100%',
    height: '100%',
    borderRadius: radii.sm,
  },
});
