import React, { memo, useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { invitesApi } from '../../../extensions/api/invitesApi';
import { ExtPremiumRow } from '../../../extensions/components/ExtPremiumRow';
import { useAuthStore } from '../../../auth/store/authStore';
import { useMe } from '../../../profile/hooks/useProfile';
import { useHouses } from '../../../houses/hooks/useHouses';
import { isAtLeast, useAdminWhoami } from '../../../admin';
import { useAnalyticsConsentStore } from '../../../privacy';
import { DEFAULTS } from '../../../../shared/constants/images';
import { colors, layout, radii, spacing, withAlpha } from '../../../../shared/constants/theme';
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
    <Text className="text-xxs font-body-medium text-ink-muted uppercase tracking-wider mt-xxs">
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
  const { t } = useTranslation();

  const houseTiles = useMemo(() => (myHouses ?? []).slice(0, CLUBS_TILE_COUNT), [myHouses]);
  const clubsCount = myHouses?.length ?? 0;
  // Probe the godmode role lazily — failure is silent (the user just doesn't
  // see the entry). Cached 60s by the hook so we don't hit /admin/me every
  // time Settings remounts.
  const { data: adminMe } = useAdminWhoami();
  const showAdminEntry = adminMe ? isAtLeast(adminMe.appRole, 'MODERATOR') : false;
  const handleOpenAdmin = useCallback(() => navigation.navigate('AdminHome'), [navigation]);

  // Analytics opt-in lives in SecureStore so the user's choice persists
  // across reinstalls. Must be hydrated once at app start (see App.tsx).
  const analyticsEnabled = useAnalyticsConsentStore(s => s.enabled);
  const setAnalyticsEnabled = useAnalyticsConsentStore(s => s.setEnabled);
  const handleToggleAnalytics = useCallback(() => {
    void setAnalyticsEnabled(!analyticsEnabled);
  }, [analyticsEnabled, setAnalyticsEnabled]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: withTiming(analyticsEnabled ? 18 : 0, { duration: 200 }) }],
  }));

  const goPrivacyPolicy = useCallback(() => navigation.navigate('PrivacyPolicy'), [navigation]);
  const goTerms = useCallback(() => navigation.navigate('Terms'), [navigation]);
  const goDataExport = useCallback(() => navigation.navigate('DataExport'), [navigation]);
  const goDeleteAccount = useCallback(() => navigation.navigate('DeleteAccount'), [navigation]);

  // The two "Wave" buttons on Settings sit on the user's OWN profile —
  // there's no peer to wave to from here. The action that makes sense
  // semantically is "find someone to wave at", which lives on the
  // Followers screen (or any user profile via tap → wave). We surface
  // that flow with a short Alert hint instead of a no-op.
  const handleWave = useCallback(() => {
    if (!user) return;
    Alert.alert(t('settings.waveAlertTitle'), t('settings.waveAlertBody'), [
      {
        text: t('settings.waveAlertButton'),
        onPress: () =>
          navigation.navigate('Followers', { userId: user.id, initialTab: 'followers' }),
      },
      { text: 'OK', style: 'cancel' },
    ]);
  }, [navigation, user, t]);

  const handleEditProfile = useCallback(() => navigation.navigate('EditProfile'), [navigation]);

  const goNotificationSettings = useCallback(
    () => navigation.navigate('NotificationSettings'),
    [navigation],
  );

  // Personal signed invite link + remaining quota. Cached so re-entering
  // Settings doesn't re-fetch; failure leaves `invite` undefined (the row
  // shows a neutral hint and the share handler surfaces an error).
  const { data: invite } = useQuery({
    queryKey: ['ext', 'invite', 'link'],
    queryFn: () => invitesApi.getLink(),
    staleTime: 60_000,
  });

  const handleInviteFriends = useCallback(async () => {
    try {
      const link = invite ?? (await invitesApi.getLink());
      if (link.remaining <= 0) {
        Alert.alert(
          t('invite.noneLeftTitle', "Plus d'invitations"),
          t('invite.noneLeftBody', "Tu as utilisé toutes tes invitations pour l'instant."),
        );
        return;
      }
      await Share.share({
        message: t('invite.shareMessage', {
          url: link.url,
          defaultValue: `Rejoins-moi sur Chathouse 👋 ${link.url}`,
        }),
        url: link.url,
      });
    } catch {
      Alert.alert(t('common.error', 'Une erreur est survenue'));
    }
  }, [invite, t]);

  const handleToggleBio = useCallback(() => setBioExpanded(v => !v), []);

  const handleMore = useCallback(() => {
    Alert.alert(t('settings.account'), undefined, [
      { text: t('settings.cancel'), style: 'cancel' },
      {
        text: t('settings.signOut'),
        style: 'destructive',
        onPress: () => {
          void signOut();
        },
      },
    ]);
  }, [signOut, t]);

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
          <Text className="text-lg font-display text-primary tracking-tighter">
            {t('common.appName', 'Chathouse')}
          </Text>
        </View>
        <Pressable
          onPress={handleWave}
          accessibilityRole="button"
          accessibilityLabel={t('settings.sendWaveA11y', 'Send a wave')}
          className="bg-primary/10 px-lg py-xs rounded-pill"
        >
          <Text className="text-sm font-body-bold text-primary">{t('feed.wave', 'Wave 👋')}</Text>
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
            {user?.displayName ?? t('settings.yourProfile')}
          </Text>
          <Text className="text-sm font-body-medium text-ink-muted mt-xxs">
            @{user?.username ?? t('settings.username')}
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
                accessibilityLabel={
                  bioExpanded
                    ? t('settings.collapseBioA11y', 'Collapse bio')
                    : t('settings.expandBioA11y', 'Expand bio')
                }
                hitSlop={8}
                className="mt-xxs"
              >
                <Text className="text-xs font-body-bold text-primary">
                  {bioExpanded ? t('settings.seeLess') : t('settings.seeMore')}
                </Text>
              </Pressable>
            </View>
          )}

          <View className="flex-row items-center gap-lg mt-lg">
            <Stat
              label={t('settings.followers')}
              value={formatCount(user?.followersCount ?? 0)}
              onPress={handleFollowersTap}
            />
            <View style={styles.statDivider} />
            <Stat
              label={t('settings.following')}
              value={formatCount(user?.followingCount ?? 0)}
              onPress={handleFollowingTap}
            />
            <View style={styles.statDivider} />
            <Stat label={t('settings.clubs')} value={String(clubsCount)} />
          </View>

          <View className="flex-row items-center gap-sm mt-xl">
            <Pressable
              onPress={handleEditProfile}
              accessibilityRole="button"
              accessibilityLabel={t('settings.editProfile')}
              className="rounded-pill overflow-hidden active:opacity-90"
            >
              <LinearGradient
                colors={PRIMARY_GRADIENT}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.primaryBtn}
              >
                <Text className="text-sm font-body-bold text-on-primary-container">
                  {t('settings.editProfile')}
                </Text>
              </LinearGradient>
            </Pressable>
            <Pressable
              onPress={handleWave}
              accessibilityRole="button"
              accessibilityLabel={t('room.waveA11y')}
              className="border border-primary/30 rounded-pill px-xl py-sm active:opacity-80"
            >
              <Text className="text-sm font-body-bold text-primary">{t('feed.wave')}</Text>
            </Pressable>
            <Pressable
              onPress={handleMore}
              accessibilityRole="button"
              accessibilityLabel={t('settings.moreA11y')}
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
            accessibilityLabel={t('settings.createHouseA11y', 'Create a new house')}
            className="rounded-pill overflow-hidden active:opacity-90"
          >
            <LinearGradient
              colors={ACCENT_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.createHouseBtn}
            >
              <MaterialIcons name="home-work" size={20} color={colors.white} />
              <Text className="text-sm font-body-bold text-white ml-sm">
                {t('settings.createHouse')}
              </Text>
            </LinearGradient>
          </Pressable>
        </View>

        <View className="px-xxl mt-xxl">
          <View className="flex-row items-center justify-between mb-md">
            <Text className="text-md font-display text-white">{t('settings.memberOf')}</Text>
            <Pressable
              onPress={handleViewAllHouses}
              accessibilityRole="button"
              accessibilityLabel={t('settings.viewAll')}
              hitSlop={8}
            >
              <Text className="text-xs font-body-bold text-primary">{t('settings.viewAll')}</Text>
            </Pressable>
          </View>
          <View style={styles.housesGrid}>
            {houseTiles.map(h => (
              <HouseTile key={h.id} house={h} onPress={handleOpenHouse} />
            ))}
          </View>
        </View>

        {/* Premium — hidden unless Stripe/premium is configured server-side. */}
        <View className="px-xxl mt-xxl">
          <ExtPremiumRow />
        </View>

        {showAdminEntry ? (
          <View className="px-xxl mt-xxl">
            <Pressable
              onPress={handleOpenAdmin}
              accessibilityRole="button"
              accessibilityLabel={t('settings.openGodmodeA11y', 'Open Godmode')}
              style={styles.adminEntry}
            >
              <View style={styles.adminIcon}>
                <MaterialIcons name="security" size={20} color={colors.primary} />
              </View>
              <View style={styles.flex1}>
                <Text className="text-md font-body-bold text-white">{t('settings.godmode')}</Text>
                <Text className="text-xs text-ink-muted mt-xxs">
                  {t('settings.adminAccess', { role: adminMe?.appRole })}
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color={colors.textMuted} />
            </Pressable>
          </View>
        ) : null}

        {/* Privacy / GDPR — visible for every signed-in user. */}
        <View className="px-xxl mt-xxl gap-md">
          <Text className="text-xs font-body-bold uppercase tracking-widest text-ink-muted">
            {t('settings.privacySection')}
          </Text>
          <Pressable
            onPress={handleToggleAnalytics}
            accessibilityRole="switch"
            accessibilityLabel={t(
              'settings.anonymousErrorReportingA11y',
              'Allow anonymous crash reporting',
            )}
            accessibilityState={{ checked: analyticsEnabled }}
            style={styles.privacyRow}
          >
            <View style={styles.privacyIcon}>
              <MaterialIcons name="bug-report" size={18} color={colors.primary} />
            </View>
            <View style={styles.flex1}>
              <Text className="text-sm font-body-bold text-white">
                {t('settings.anonymousErrorReporting')}
              </Text>
              <Text className="text-xs text-ink-muted mt-xxs">
                {t('settings.anonymousErrorReportingDesc')}
              </Text>
            </View>
            <View
              style={[
                styles.toggleTrack,
                analyticsEnabled ? styles.toggleTrackOn : styles.toggleTrackOff,
              ]}
            >
              <Animated.View style={[styles.toggleThumb, thumbStyle]} />
            </View>
          </Pressable>

          <SettingsRow
            icon="policy"
            label={t('settings.privacyPolicy')}
            onPress={goPrivacyPolicy}
          />
          <SettingsRow icon="description" label={t('settings.termsOfService')} onPress={goTerms} />
          <SettingsRow
            icon="download"
            label={t('settings.exportData')}
            hint={t('settings.gdprArticle20')}
            onPress={goDataExport}
          />
        </View>

        {/* Account — sign out + delete sit at the bottom, danger color
            highlights the irreversible action. */}
        <View className="px-xxl mt-xxl gap-md">
          <Text className="text-xs font-body-bold uppercase tracking-widest text-ink-muted">
            {t('settings.accountSection')}
          </Text>
          <SettingsRow
            icon="person-add"
            label={t('invite.inviteFriends', 'Inviter des amis')}
            hint={
              invite
                ? t('invite.remaining', {
                    count: invite.remaining,
                    defaultValue: `${invite.remaining} invitation(s) restante(s)`,
                  })
                : t('invite.shareHint', 'Partage ton lien personnel')
            }
            onPress={handleInviteFriends}
          />
          <SettingsRow
            icon="notifications"
            label={t('settings.notifications')}
            onPress={goNotificationSettings}
          />
          <SettingsRow
            icon="delete-forever"
            label={t('settings.deleteAccount')}
            danger
            onPress={goDeleteAccount}
          />
        </View>
      </ScrollView>
    </View>
  );
};

interface SettingsRowProps {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  hint?: string;
  danger?: boolean;
  onPress: () => void;
}

const SettingsRow: React.FC<SettingsRowProps> = ({ icon, label, hint, danger, onPress }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
    style={[styles.privacyRow, danger ? styles.privacyRowDanger : null]}
  >
    <View style={[styles.privacyIcon, danger ? styles.privacyIconDanger : null]}>
      <MaterialIcons name={icon} size={18} color={danger ? colors.danger : colors.primary} />
    </View>
    <View style={styles.flex1}>
      <Text style={danger ? styles.settingsRowLabelDanger : styles.settingsRowLabel}>{label}</Text>
      {hint ? <Text className="text-xs text-ink-muted mt-xxs">{hint}</Text> : null}
    </View>
    <MaterialIcons name="chevron-right" size={22} color={colors.textMuted} />
  </Pressable>
);

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
    backgroundColor: withAlpha(colors.surfaceLowest, 0.35),
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
    backgroundColor: colors.overlayWhite15,
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
  adminEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: withAlpha(colors.accent, 0.08),
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.3),
  },
  adminIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: withAlpha(colors.accent, 0.15),
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radii.md,
    backgroundColor: colors.overlayWhite4,
    borderWidth: 1,
    borderColor: colors.glassStrong,
  },
  // Saturated-red literals (NOT withAlpha(colors.danger,…)). colors.danger is
  // the pale error *foreground* role (#ffb4ab) — fine for the icon glyph/text,
  // but as a container tint it reads as soft pink and loses the destructive-
  // action affordance. The fill/border tints stay vivid red (#ef4444).
  privacyRowDanger: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  privacyIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: withAlpha(colors.accent, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyIconDanger: { backgroundColor: 'rgba(239, 68, 68, 0.15)' },
  toggleTrack: { width: 44, height: 26, borderRadius: radii.pill, padding: 2 },
  toggleTrackOn: { backgroundColor: colors.primary },
  toggleTrackOff: { backgroundColor: colors.overlayWhite15 },
  toggleThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.white },
  houseIcon: {
    width: '100%',
    height: '100%',
    borderRadius: radii.sm,
  },
  flex1: {
    flex: 1,
  },
  settingsRowLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  settingsRowLabelDanger: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '700',
  },
});
