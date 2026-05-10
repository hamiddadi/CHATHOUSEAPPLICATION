import React, { memo, useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../auth/store/authStore';
import { useMe } from '../../../profile/hooks/useProfile';
import { useHouses } from '../../../houses/hooks/useHouses';
import { isAtLeast, useAdminWhoami } from '../../../admin';
import { useAnalyticsConsentStore } from '../../../privacy';
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
    Alert.alert(
      'Wave 👋',
      'Pour faire un wave à un ami, ouvre son profil depuis la liste de tes followers ou depuis une room.',
      [
        {
          text: 'Mes followers',
          onPress: () =>
            navigation.navigate('Followers', { userId: user.id, initialTab: 'followers' }),
        },
        { text: 'OK', style: 'cancel' },
      ],
    );
  }, [navigation, user]);

  const handleEditProfile = useCallback(() => navigation.navigate('EditProfile'), [navigation]);

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

        {showAdminEntry ? (
          <View className="px-xxl mt-xxl">
            <Pressable
              onPress={handleOpenAdmin}
              accessibilityRole="button"
              accessibilityLabel="Ouvrir Godmode"
              style={styles.adminEntry}
            >
              <View style={styles.adminIcon}>
                <MaterialIcons name="security" size={20} color={colors.primary} />
              </View>
              <View style={styles.flex1}>
                <Text className="text-md font-body-bold text-white">Godmode</Text>
                <Text className="text-xs text-ink-muted mt-xxs">
                  Accès modération · {adminMe?.appRole}
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color={colors.textMuted} />
            </Pressable>
          </View>
        ) : null}

        {/* Privacy / GDPR — visible for every signed-in user. */}
        <View className="px-xxl mt-xxl gap-md">
          <Text className="text-xs font-body-bold uppercase tracking-widest text-ink-muted">
            Confidentialité
          </Text>
          <Pressable
            onPress={handleToggleAnalytics}
            accessibilityRole="switch"
            accessibilityLabel="Autoriser le crash reporting anonyme"
            accessibilityState={{ checked: analyticsEnabled }}
            style={styles.privacyRow}
          >
            <View style={styles.privacyIcon}>
              <MaterialIcons name="bug-report" size={18} color={colors.primary} />
            </View>
            <View style={styles.flex1}>
              <Text className="text-sm font-body-bold text-white">
                Rapports d&apos;erreur anonymes
              </Text>
              <Text className="text-xs text-ink-muted mt-xxs">
                Aide à corriger les crashs. Désactivé par défaut.
              </Text>
            </View>
            <View
              style={[
                styles.toggleTrack,
                analyticsEnabled ? styles.toggleTrackOn : styles.toggleTrackOff,
              ]}
            >
              <View
                style={[
                  styles.toggleThumb,
                  analyticsEnabled ? styles.toggleThumbOn : styles.toggleThumbOff,
                ]}
              />
            </View>
          </Pressable>

          <SettingsRow
            icon="policy"
            label="Politique de confidentialité"
            onPress={goPrivacyPolicy}
          />
          <SettingsRow icon="description" label="Conditions d'utilisation" onPress={goTerms} />
          <SettingsRow
            icon="download"
            label="Exporter mes données"
            hint="Article 20 du RGPD"
            onPress={goDataExport}
          />
        </View>

        {/* Account — sign out + delete sit at the bottom, danger color
            highlights the irreversible action. */}
        <View className="px-xxl mt-xxl gap-md">
          <Text className="text-xs font-body-bold uppercase tracking-widest text-ink-muted">
            Compte
          </Text>
          <SettingsRow
            icon="delete-forever"
            label="Supprimer mon compte"
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
  adminEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: 12,
    backgroundColor: 'rgba(0,228,117,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,228,117,0.3)',
  },
  adminIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,228,117,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  privacyRowDanger: {
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderColor: 'rgba(239,68,68,0.3)',
  },
  privacyIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,228,117,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyIconDanger: { backgroundColor: 'rgba(239,68,68,0.15)' },
  toggleTrack: { width: 44, height: 26, borderRadius: 999, padding: 2 },
  toggleTrackOn: { backgroundColor: colors.primary },
  toggleTrackOff: { backgroundColor: 'rgba(255,255,255,0.15)' },
  toggleThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  toggleThumbOn: { transform: [{ translateX: 18 }] },
  toggleThumbOff: { transform: [{ translateX: 0 }] },
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
