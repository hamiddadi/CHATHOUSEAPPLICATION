import React, { useCallback, useMemo, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../../shared/components/Button';
import { impactLight } from '../../../../shared/utils/haptics';
import { colors, radii, spacing } from '../../../../shared/constants/theme';
import { useOnboardingStore } from '../../store/onboardingStore';
import { INTEREST_CATEGORIES, type InterestCategory } from '../../schemas';
import type { OnboardingStackScreenProps } from '../../../../core/navigation/types';

const MIN_INTERESTS = 3;
const MAX_INTERESTS = 10;
// The backend caps at MAX_INTERESTS, but the UI can never offer more chips
// than there are categories — use the smaller of the two everywhere so the
// "n / max" counter shows a cap the user can actually reach.
const EFFECTIVE_MAX = Math.min(MAX_INTERESTS, INTEREST_CATEGORIES.length);

/**
 * Step 2 of onboarding. User toggles interest chips (min 3, max EFFECTIVE_MAX)
 * and taps "Next" to persist the selection into the onboarding store, then
 * advances to the SuggestedFollows step — which owns the final
 * completeOnboarding() call. The interests survive in the store until then.
 */
export const InterestSelectionScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const navigation = useNavigation<OnboardingStackScreenProps<'InterestSelection'>['navigation']>();
  const setInterestsInStore = useOnboardingStore(s => s.setInterests);

  // Rehydrate from the onboarding store so a back-navigation (or a failed
  // finish on a later step) doesn't wipe the user's earlier selection.
  const [selected, setSelected] = useState<Set<InterestCategory>>(
    () =>
      new Set(
        useOnboardingStore
          .getState()
          .interests.filter((i): i is InterestCategory =>
            (INTEREST_CATEGORIES as readonly string[]).includes(i),
          ),
      ),
  );

  const maxReachedMessage = t('onboarding.interests.maxReached', {
    max: EFFECTIVE_MAX,
    defaultValue: `You can pick up to ${EFFECTIVE_MAX}.`,
  });

  const toggle = useCallback(
    (cat: InterestCategory) => {
      // Tapping a new chip while at the cap: give tactile + screen-reader
      // feedback instead of silently ignoring the press.
      if (!selected.has(cat) && selected.size >= EFFECTIVE_MAX) {
        impactLight();
        AccessibilityInfo.announceForAccessibility(maxReachedMessage);
        return;
      }
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(cat)) {
          next.delete(cat);
        } else if (next.size < EFFECTIVE_MAX) {
          next.add(cat);
        }
        return next;
      });
    },
    [selected, maxReachedMessage],
  );

  const interests = useMemo(() => [...selected], [selected]);
  const canSubmit = interests.length >= MIN_INTERESTS;

  const onFinish = useCallback(() => {
    if (interests.length < MIN_INTERESTS) return;
    // Persist the selection so the SuggestedFollows step can flush it to the
    // backend when the user finishes onboarding there. No async work happens
    // here (this screen stays mounted in the stack), so we don't gate on a
    // `submitting` flag — doing so left the button stuck disabled after the
    // user navigated back to this screen.
    setInterestsInStore(interests);
    navigation.navigate('NotificationsPermission');
  }, [interests, navigation, setInterestsInStore]);

  const atMax = interests.length >= EFFECTIVE_MAX;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top + spacing.xl }}>
      {/* Discreet back chevron — the previous SetupProfile step stays in the stack. */}
      <View className="flex-row items-center px-xxl py-sm">
        <Pressable
          onPress={() => {
            if (navigation.canGoBack()) navigation.goBack();
          }}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', 'Back')}
          hitSlop={12}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.textMuted} />
        </Pressable>
      </View>
      <View
        className="flex-1 px-xxl gap-xxl"
        style={{ paddingBottom: insets.bottom + spacing.huge }}
      >
        <View className="gap-md">
          <Text className="text-display font-display text-ink tracking-tight">
            {t('onboarding.interests.title')}
          </Text>
          <Text className="text-md text-ink-muted">{t('onboarding.interests.subtitle')}</Text>
          <Text className="text-sm text-ink-muted">
            {interests.length < MIN_INTERESTS
              ? t('onboarding.interests.minHint')
              : `${interests.length} / ${EFFECTIVE_MAX}`}
            {atMax ? ` — ${maxReachedMessage}` : ''}
          </Text>
        </View>

        <ScrollView contentContainerStyle={chipWrapStyle} showsVerticalScrollIndicator={false}>
          {INTEREST_CATEGORIES.map(cat => {
            const isSelected = selected.has(cat);
            return (
              <Pressable
                key={cat}
                onPress={() => toggle(cat)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                hitSlop={8}
                style={[chipBase, isSelected ? chipSelected : chipUnselected]}
              >
                <Text style={isSelected ? chipLabelSelected : chipLabelUnselected}>
                  {t(`onboarding.interests.categories.${cat}`)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Button
          label={t('onboarding.interests.finish')}
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canSubmit}
          onPress={onFinish}
        />
      </View>
    </View>
  );
};

const chipWrapStyle = {
  flexDirection: 'row' as const,
  flexWrap: 'wrap' as const,
  gap: spacing.md,
  paddingVertical: spacing.md,
};

const chipBase = {
  paddingHorizontal: spacing.lg,
  paddingVertical: spacing.md,
  borderRadius: radii.xxl,
  borderWidth: 1,
};

const chipUnselected = {
  borderColor: colors.outline,
  backgroundColor: 'transparent',
};

const chipSelected = {
  borderColor: colors.primary,
  backgroundColor: colors.primary,
};

const chipLabelSelected = { color: colors.background, fontWeight: '700' as const };
const chipLabelUnselected = { color: colors.text, fontWeight: '500' as const };
