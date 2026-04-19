import React, { memo, useCallback, useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { Avatar } from '../../../../shared/components/Avatar';
import { useAnimatedPress } from '../../../../shared/hooks/useAnimatedPress';
import { useOnMount } from '../../../../shared/hooks/useOnMount';
import { AVATARS_10 } from '../../../../shared/constants/images';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { LandingNavProp } from '../../../../core/navigation/types';

/* ============================================================
 * Constants (hoisted — avoids re-creation per render)
 * ========================================================== */

const AVATAR_URLS: readonly string[] = AVATARS_10.slice(0, 7);

const ENTRY_DURATION_MS = 600;
const ENTRY_OFFSET_Y = 24;
const LOGO_DELAY_MS = 0;
const FEATURES_DELAY_MS = 150;
const AVATARS_DELAY_MS = 300;
const CTA_DELAY_MS = 450;

const LOGO_BOX_SIZE = 80;
const LOGO_ICON_SIZE = 40;
const LOGO_BORDER_RADIUS = 24;

const FEATURE_ICON_BOX = 44;
const FEATURE_ICON_SIZE = 22;
const FEATURE_ICON_RADIUS = 12;

const CIRCLE_SIZE_LG = 200;
const CIRCLE_SIZE_MD = 150;
const CIRCLE_SIZE_SM = 100;

const CIRCLE_TOP_OFFSET_NEG = -40;
const CIRCLE_RIGHT_OFFSET_NEG = -60;
const CIRCLE_LEFT_OFFSET_NEG = -50;
const CIRCLE_BOTTOM_OFFSET = 120;
const CIRCLE_RIGHT_OFFSET_SMALL_NEG = -20;
const CIRCLE_MID_HEIGHT_FACTOR = 0.35;

const AVATAR_OVERLAP = -12;
const CTA_BUTTON_HEIGHT = 52;
const CTA_ARROW_SIZE = 20;
const CTA_SCALE_TO = 0.96;

const GRADIENT_COLORS = [colors.gradientStart, colors.gradientMid, colors.gradientEnd] as const;

interface FeatureItemData {
  id: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  desc: string;
}

const FEATURES_DATA: readonly FeatureItemData[] = [
  {
    id: 'rooms',
    icon: 'people',
    title: 'Rejoignez des rooms live',
    desc: 'Écoutez et parlez avec des gens du monde entier',
  },
  {
    id: 'houses',
    icon: 'home',
    title: 'Créez des Houses',
    desc: 'Construisez des communautés autour des sujets que vous aimez',
  },
  {
    id: 'chat',
    icon: 'chatbubbles',
    title: 'Connectez et discutez',
    desc: 'Envoyez des messages à vos amis et découvrez de nouvelles personnes',
  },
];

interface CircleConfig {
  id: string;
  size: number;
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  heightFactor?: number;
  tintClass: string;
}

const CIRCLE_CONFIGS: readonly CircleConfig[] = [
  {
    id: 'c1',
    size: CIRCLE_SIZE_LG,
    top: CIRCLE_TOP_OFFSET_NEG,
    right: CIRCLE_RIGHT_OFFSET_NEG,
    tintClass: 'bg-overlay-white-5',
  },
  {
    id: 'c2',
    size: CIRCLE_SIZE_MD,
    left: CIRCLE_LEFT_OFFSET_NEG,
    heightFactor: CIRCLE_MID_HEIGHT_FACTOR,
    tintClass: 'bg-overlay-white-4',
  },
  {
    id: 'c3',
    size: CIRCLE_SIZE_SM,
    bottom: CIRCLE_BOTTOM_OFFSET,
    right: CIRCLE_RIGHT_OFFSET_SMALL_NEG,
    tintClass: 'bg-overlay-white-6',
  },
];

/* ============================================================
 * Sub-components (local to this screen, not exported)
 * ========================================================== */

const LandingLogo: React.FC = memo(() => (
  <View className="items-center" accessibilityRole="header">
    <View
      className="items-center justify-center bg-overlay-white-20"
      style={styles.logoContainer}
      importantForAccessibility="no"
    >
      <Ionicons name="mic" size={LOGO_ICON_SIZE} color={colors.white} />
    </View>
    <Text className="text-hero font-display text-white tracking-tighter">Chathouse</Text>
    <Text className="text-md font-body text-overlay-white-75 mt-xs">
      Drop in audio conversations
    </Text>
  </View>
));
LandingLogo.displayName = 'LandingLogo';

interface FeatureItemProps {
  icon: FeatureItemData['icon'];
  title: string;
  desc: string;
}

const FeatureItem: React.FC<FeatureItemProps> = memo(({ icon, title, desc }) => (
  <View
    accessibilityRole="text"
    accessibilityLabel={`${title}: ${desc}`}
    className="flex-row items-center bg-overlay-white-12 rounded-lg p-md"
    style={styles.featureRow}
  >
    <View className="items-center justify-center bg-white" style={styles.featureIcon}>
      <Ionicons name={icon} size={FEATURE_ICON_SIZE} color={colors.backgroundDark} />
    </View>
    <View className="flex-1 ml-md">
      <Text className="text-md font-body-bold text-white">{title}</Text>
      <Text className="text-xs font-body text-overlay-white-70 mt-xxs">{desc}</Text>
    </View>
  </View>
));
FeatureItem.displayName = 'FeatureItem';

const AvatarsPreview: React.FC = memo(() => (
  <View
    accessibilityRole="text"
    accessibilityLabel="Plus de 2000 utilisateurs en ligne"
    className="flex-row items-center justify-center"
  >
    {AVATAR_URLS.map((url, i) => (
      <View
        key={url}
        className="border-2 border-overlay-blue-50 rounded-xl"
        style={i > 0 ? styles.avatarStacked : undefined}
      >
        <Avatar uri={url} size="md" shape="rounded" />
      </View>
    ))}
    <Text className="text-xs font-body-semibold text-overlay-white-80 ml-sm">+2k online</Text>
  </View>
));
AvatarsPreview.displayName = 'AvatarsPreview';

interface LandingCTAProps {
  onGetStarted: () => void;
  onLogin: () => void;
}

const LandingCTA: React.FC<LandingCTAProps> = memo(({ onGetStarted, onLogin }) => {
  const primary = useAnimatedPress({ scaleTo: CTA_SCALE_TO });
  const secondary = useAnimatedPress({ scaleTo: CTA_SCALE_TO });

  return (
    <View className="gap-sm">
      <Animated.View style={primary.animatedStyle}>
        <Pressable
          onPress={onGetStarted}
          onPressIn={primary.onPressIn}
          onPressOut={primary.onPressOut}
          accessibilityRole="button"
          accessibilityLabel="Créer un compte"
          accessibilityHint="Navigue vers l'écran d'inscription"
          className="flex-row items-center justify-center bg-white rounded-xl gap-sm"
          style={styles.ctaButton}
        >
          <Text className="text-lg font-display text-gradient-start">Get Started</Text>
          <Ionicons name="arrow-forward" size={CTA_ARROW_SIZE} color={colors.gradientStart} />
        </Pressable>
      </Animated.View>

      <Animated.View style={secondary.animatedStyle}>
        <Pressable
          onPress={onLogin}
          onPressIn={secondary.onPressIn}
          onPressOut={secondary.onPressOut}
          accessibilityRole="button"
          accessibilityLabel="Se connecter"
          accessibilityHint="Navigue vers l'écran de connexion"
          className="items-center justify-center rounded-xl border-2 border-overlay-white-30"
          style={styles.ctaButton}
        >
          <Text className="text-md font-body-semibold text-white">I already have an account</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
});
LandingCTA.displayName = 'LandingCTA';

/* ============================================================
 * Screen
 * ========================================================== */

export const LandingScreen: React.FC = () => {
  const navigation = useNavigation<LandingNavProp>();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  const handleGetStarted = useCallback(() => navigation.navigate('Phone'), [navigation]);
  const handleLogin = useCallback(() => navigation.navigate('Phone'), [navigation]);

  // Entry shared values
  const logoOpacity = useSharedValue(0);
  const logoY = useSharedValue(ENTRY_OFFSET_Y);
  const featuresOpacity = useSharedValue(0);
  const featuresY = useSharedValue(ENTRY_OFFSET_Y);
  const avatarsOpacity = useSharedValue(0);
  const ctaOpacity = useSharedValue(0);
  const ctaY = useSharedValue(ENTRY_OFFSET_Y);

  useOnMount(() => {
    if (__DEV__ && AVATAR_URLS.length === 0) {
      console.warn('[LandingScreen] AVATAR_URLS is empty — avatars row will not render.');
    }

    const fadeIn = { duration: ENTRY_DURATION_MS };

    logoOpacity.value = withDelay(LOGO_DELAY_MS, withTiming(1, fadeIn));
    logoY.value = withDelay(LOGO_DELAY_MS, withTiming(0, fadeIn));

    featuresOpacity.value = withDelay(FEATURES_DELAY_MS, withTiming(1, fadeIn));
    featuresY.value = withDelay(FEATURES_DELAY_MS, withTiming(0, fadeIn));

    avatarsOpacity.value = withDelay(AVATARS_DELAY_MS, withTiming(1, fadeIn));

    ctaOpacity.value = withDelay(CTA_DELAY_MS, withTiming(1, fadeIn));
    ctaY.value = withDelay(CTA_DELAY_MS, withTiming(0, fadeIn));
  });

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ translateY: logoY.value }],
  }));
  const featuresStyle = useAnimatedStyle(() => ({
    opacity: featuresOpacity.value,
    transform: [{ translateY: featuresY.value }],
  }));
  const avatarsStyle = useAnimatedStyle(() => ({ opacity: avatarsOpacity.value }));
  const ctaStyle = useAnimatedStyle(() => ({
    opacity: ctaOpacity.value,
    transform: [{ translateY: ctaY.value }],
  }));

  const containerPadding = useMemo(
    () => ({
      paddingTop: insets.top + spacing.lg,
      paddingBottom: insets.bottom + spacing.lg,
    }),
    [insets.top, insets.bottom],
  );

  return (
    <LinearGradient
      colors={GRADIENT_COLORS}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.container, containerPadding]}
    >
      {CIRCLE_CONFIGS.map(cfg => (
        <View
          key={cfg.id}
          importantForAccessibility="no"
          className={`absolute ${cfg.tintClass}`}
          style={{
            width: cfg.size,
            height: cfg.size,
            borderRadius: cfg.size / 2,
            top: cfg.top ?? (cfg.heightFactor ? height * cfg.heightFactor : undefined),
            bottom: cfg.bottom,
            left: cfg.left,
            right: cfg.right,
          }}
        />
      ))}

      <Animated.View style={logoStyle}>
        <LandingLogo />
      </Animated.View>

      <Animated.View style={featuresStyle} className="gap-md">
        {FEATURES_DATA.map(f => (
          <FeatureItem key={f.id} icon={f.icon} title={f.title} desc={f.desc} />
        ))}
      </Animated.View>

      <Animated.View style={avatarsStyle}>
        <AvatarsPreview />
      </Animated.View>

      <Animated.View style={ctaStyle}>
        <LandingCTA onGetStarted={handleGetStarted} onLogin={handleLogin} />
      </Animated.View>
    </LinearGradient>
  );
};

/* ============================================================
 * Styles — only where className can't express the value (dynamic dims, shadows)
 * ========================================================== */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  logoContainer: {
    width: LOGO_BOX_SIZE,
    height: LOGO_BOX_SIZE,
    borderRadius: LOGO_BORDER_RADIUS,
    marginBottom: spacing.md,
  },
  featureRow: {
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 2 },
    }),
  },
  featureIcon: {
    width: FEATURE_ICON_BOX,
    height: FEATURE_ICON_BOX,
    borderRadius: FEATURE_ICON_RADIUS,
  },
  avatarStacked: {
    marginLeft: AVATAR_OVERLAP,
  },
  ctaButton: {
    height: CTA_BUTTON_HEIGHT,
  },
});
