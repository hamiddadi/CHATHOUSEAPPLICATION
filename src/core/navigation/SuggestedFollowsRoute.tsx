import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Button } from '../../shared/components/Button';
import { spacing } from '../../shared/constants/theme';
import { useApiErrorToast } from '../../shared/hooks/useApiErrorToast';
import { useAuthStore } from '../../features/auth/store/authStore';
import { useOnboardingStore } from '../../features/onboarding/store/onboardingStore';
import { useFollow } from '../../features/profile/hooks/useProfile';
import { ExtSuggestedFollowsScreen } from '../../features/extensions';

/**
 * Final onboarding step. Wraps the (otherwise standalone) extension screen
 * `ExtSuggestedFollowsScreen` and owns the onboarding completion: both
 * "Done" and "Skip for now" flush the accumulated profile + interests
 * (gathered on the previous screens and held in the onboarding store) to the
 * backend via `completeOnboarding`. On success the authStore's
 * `user.hasCompletedOnboarding` flips and the RootNavigator swaps to Main.
 */
export const SuggestedFollowsRoute: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const follow = useFollow();
  const complete = useAuthStore(s => s.completeOnboarding);
  const profile = useOnboardingStore(s => ({
    displayName: s.displayName,
    bio: s.bio,
    avatarUrl: s.avatarUrl,
    interests: s.interests,
  }));
  const resetOnboarding = useOnboardingStore(s => s.reset);
  const toastError = useApiErrorToast();

  const [finishing, setFinishing] = useState(false);

  const finishOnboarding = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await complete({
        displayName: profile.displayName,
        bio: profile.bio,
        avatarUrl: profile.avatarUrl,
        interests: profile.interests,
      });
      resetOnboarding();
      // RootNavigator observes user.hasCompletedOnboarding and swaps to the
      // Main stack automatically; no manual navigation here.
    } catch (err) {
      // Surface network/timeout/server (422) failures. Keep the onboarding
      // store intact so the user can simply tap again.
      toastError(err);
    } finally {
      setFinishing(false);
    }
  }, [complete, finishing, profile, resetOnboarding, toastError]);

  return (
    <View style={styles.container}>
      <View style={styles.body}>
        <ExtSuggestedFollowsScreen onFollow={user => follow.mutate(user.id)} onTapUser={() => {}} />
      </View>
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Button
          label={t('onboarding.suggestedFollows.done')}
          variant="primary"
          size="lg"
          fullWidth
          loading={finishing}
          disabled={finishing}
          onPress={finishOnboarding}
        />
        <Button
          label={t('onboarding.suggestedFollows.skip')}
          variant="ghost"
          size="lg"
          fullWidth
          disabled={finishing}
          onPress={finishOnboarding}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { flex: 1 },
  footer: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
});
