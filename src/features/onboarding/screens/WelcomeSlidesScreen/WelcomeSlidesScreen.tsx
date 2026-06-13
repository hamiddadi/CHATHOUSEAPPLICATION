import React, { useCallback, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../../shared/components/Button';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { AuthStackParamList } from '../../../../core/navigation/types';
import { welcomeStorage } from '../../services/welcomeStorage';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'WelcomeSlides'>;

interface SlideDef {
  key: 'welcome' | 'rooms' | 'clubs' | 'topics';
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
}

const SLIDES: readonly SlideDef[] = [
  { key: 'welcome', icon: 'graphic-eq' },
  { key: 'rooms', icon: 'mic' },
  { key: 'clubs', icon: 'home' },
  { key: 'topics', icon: 'tag' },
] as const;

const { width: WINDOW_WIDTH } = Dimensions.get('window');

export const WelcomeSlidesScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const listRef = useRef<FlatList<SlideDef>>(null);
  const [index, setIndex] = useState(0);

  const goLanding = useCallback(async () => {
    await welcomeStorage.markSeen();
    // `replace` so back-swipe doesn't take the user back into the slides
    // after they've finished them.
    navigation.replace('Landing');
  }, [navigation]);

  const handleNext = useCallback(() => {
    const next = index + 1;
    if (next >= SLIDES.length) {
      void goLanding();
      return;
    }
    // Drive `index` (and the progress dots) from the button itself — relying
    // solely on onMomentumScrollEnd left it stale when a programmatic scroll
    // didn't emit a momentum-end event on some platforms.
    setIndex(next);
    listRef.current?.scrollToIndex({ index: next, animated: true });
  }, [goLanding, index]);

  const onMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / WINDOW_WIDTH);
    setIndex(next);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: SlideDef }) => (
      <View style={{ width: WINDOW_WIDTH }} className="px-xxl items-center justify-center">
        <View className="w-32 h-32 rounded-pill bg-primary-container items-center justify-center mb-xxxl">
          <MaterialIcons name={item.icon} size={56} color={colors.primary} />
        </View>
        <Text className="text-display font-display text-ink text-center mb-lg">
          {t(`onboarding.welcome.slides.${item.key}.title`)}
        </Text>
        <Text className="text-md text-ink-muted text-center max-w-xs">
          {t(`onboarding.welcome.slides.${item.key}.body`)}
        </Text>
      </View>
    ),
    [t],
  );

  const isLast = index === SLIDES.length - 1;

  return (
    <View className="flex-1 bg-background" style={[styles.fill, { paddingTop: insets.top }]}>
      {/* Skip button — hidden on the last slide since "Get started" closes the flow. */}
      <View className="flex-row justify-end px-xxl py-lg" style={styles.headerRow}>
        {!isLast && (
          <Pressable onPress={goLanding} accessibilityRole="button" hitSlop={8}>
            <Text className="text-sm font-body-medium text-ink-muted">
              {t('onboarding.welcome.skip')}
            </Text>
          </Pressable>
        )}
      </View>

      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={s => s.key}
        renderItem={renderItem}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        getItemLayout={(_d, i) => ({
          length: WINDOW_WIDTH,
          offset: WINDOW_WIDTH * i,
          index: i,
        })}
      />

      {/* Progress dots — cheap, no animation library needed. */}
      <View className="flex-row justify-center gap-sm py-lg">
        {SLIDES.map((s, i) => (
          <View
            key={s.key}
            style={[styles.dotBase, i === index ? styles.dotActive : styles.dotInactive]}
          />
        ))}
      </View>

      <View className="px-xxl" style={{ paddingBottom: insets.bottom + spacing.xl }}>
        <Button
          label={isLast ? t('onboarding.welcome.start') : t('onboarding.welcome.next')}
          variant="primary"
          size="lg"
          fullWidth
          onPress={handleNext}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  headerRow: { minHeight: 44 },
  dotBase: { height: 8, borderRadius: 4 },
  dotActive: { width: 20, backgroundColor: colors.primary },
  dotInactive: { width: 8, backgroundColor: colors.outline },
});
