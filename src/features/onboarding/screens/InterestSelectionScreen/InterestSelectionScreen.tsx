import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../../shared/components/Button';
import { colors, radii, spacing } from '../../../../shared/constants/theme';
import { useApiErrorToast } from '../../../../shared/hooks/useApiErrorToast';
import { useAuthStore } from '../../../auth/store/authStore';
import { useOnboardingStore } from '../../store/onboardingStore';
import { INTEREST_CATEGORIES, type InterestCategory } from '../../schemas';

const MAX_INTERESTS = 10;

/**
 * Step 2 of onboarding. User toggles interest chips (min 1, max 10) and
 * taps "Finish" to flush the accumulated profile + interests to the
 * backend. On success the authStore's user.hasCompletedOnboarding flips,
 * which the root navigator uses to switch to the Main tabs.
 */
export const InterestSelectionScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const complete = useAuthStore(s => s.completeOnboarding);
  const profile = useOnboardingStore(s => ({
    displayName: s.displayName,
    bio: s.bio,
    avatarUrl: s.avatarUrl,
  }));
  const setInterestsInStore = useOnboardingStore(s => s.setInterests);
  const resetOnboarding = useOnboardingStore(s => s.reset);
  const toastError = useApiErrorToast();

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
  const canSubmit = interests.length >= 1 && !submitting;

  const onFinish = useCallback(async () => {
    if (interests.length === 0) return;
    setSubmitting(true);
    try {
      setInterestsInStore(interests);
      await complete({
        displayName: profile.displayName,
        bio: profile.bio,
        avatarUrl: profile.avatarUrl,
        interests,
      });
      resetOnboarding();
      // RootNavigator observes user.hasCompletedOnboarding and swaps to
      // the Main stack automatically; no manual navigation here.
    } catch (err) {
      // Surface network/timeout/server (422) failures instead of failing
      // silently. We intentionally do NOT resetOnboarding() here so the
      // selected interests survive and the user can simply tap Finish again.
      toastError(err);
    } finally {
      setSubmitting(false);
    }
  }, [complete, interests, profile, resetOnboarding, setInterestsInStore, toastError]);

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
            {interests.length === 0
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
