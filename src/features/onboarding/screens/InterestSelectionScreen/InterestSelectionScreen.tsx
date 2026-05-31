import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../../shared/components/Button';
import { colors, radii, spacing } from '../../../../shared/constants/theme';
import { useOnboardingStore } from '../../store/onboardingStore';
import { INTEREST_CATEGORIES, type InterestCategory } from '../../schemas';
import type { OnboardingStackScreenProps } from '../../../../core/navigation/types';

const MIN_INTERESTS = 3;
const MAX_INTERESTS = 10;

/**
 * Step 2 of onboarding. User toggles interest chips (min 3, max 10) and
 * taps "Next" to persist the selection into the onboarding store, then
 * advances to the SuggestedFollows step — which owns the final
 * completeOnboarding() call. The interests survive in the store until then.
 */
export const InterestSelectionScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const navigation = useNavigation<OnboardingStackScreenProps<'InterestSelection'>['navigation']>();
  const setInterestsInStore = useOnboardingStore(s => s.setInterests);

  const [selected, setSelected] = useState<Set<InterestCategory>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const toggle = useCallback((cat: InterestCategory) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else if (next.size < MAX_INTERESTS) {
        next.add(cat);
      }
      return next;
    });
  }, []);

  const interests = useMemo(() => [...selected], [selected]);
  const canSubmit = interests.length >= MIN_INTERESTS && !submitting;

  const onFinish = useCallback(() => {
    if (interests.length < MIN_INTERESTS) return;
    setSubmitting(true);
    // Persist the selection so the SuggestedFollows step can flush it to the
    // backend when the user finishes onboarding there. We deliberately do NOT
    // complete onboarding here — that now happens after the follow-suggestions
    // step. Leaving `submitting` true keeps the button disabled during the
    // navigation transition; the screen unmounts before it would matter.
    setInterestsInStore(interests);
    navigation.navigate('NotificationsPermission');
  }, [interests, navigation, setInterestsInStore]);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top + spacing.xl }}>
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
              : `${interests.length} / ${MAX_INTERESTS}`}
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
          loading={submitting}
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
