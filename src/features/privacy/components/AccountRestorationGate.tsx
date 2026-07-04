import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../auth/store/authStore';
import { privacyService } from '../services/privacyService';

/**
 * RGPD deletion grace-period gate.
 *
 * When a user who scheduled their account for deletion signs back in during the
 * 30-day grace window, the backend still authenticates them (auth.middleware
 * lets a soft-deleted account through so it can self-cancel). This component
 * detects that state on authentication and offers a one-tap restore
 * (privacyService.cancelDeletion), making the "cancel deletion" promise
 * actionable from the app instead of only via a raw API call.
 *
 * Renders nothing — it only runs the check + shows the Alert. Mounted once, high
 * in the tree (RootNavigator), so it survives navigation.
 */
export const AccountRestorationGate: React.FC = () => {
  const { t } = useTranslation();
  const status = useAuthStore(s => s.status);
  const userId = useAuthStore(s => s.user?.id ?? null);
  const refreshMe = useAuthStore(s => s.refreshMe);

  // Guard against re-prompting the same user twice within a session (the effect
  // re-runs on unrelated store changes, and cancellation refetches `me`).
  const promptedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (status !== 'authenticated' || !userId) {
      // Reset when the session ends so a different account is re-checked.
      if (status === 'unauthenticated') promptedForRef.current = null;
      return;
    }
    if (promptedForRef.current === userId) return;

    let cancelled = false;
    void (async () => {
      let deleting: boolean;
      try {
        const st = await privacyService.getDeletionStatus();
        deleting = st.inGracePeriod;
      } catch {
        // Network/transient failure — don't mark as prompted so a later render
        // (or app resume) can retry. Simply skip this pass.
        return;
      }
      if (cancelled || !deleting) return;
      // Only mark prompted once we actually decide to show the Alert, so a
      // failed status check above doesn't permanently suppress the prompt.
      promptedForRef.current = userId;

      Alert.alert(
        t('privacy.restore.title', 'Account scheduled for deletion'),
        t(
          'privacy.restore.body',
          'Your account is being deleted. Would you like to restore it and keep your data?',
        ),
        [
          { text: t('privacy.restore.dismiss', 'Not now'), style: 'cancel' },
          {
            text: t('privacy.restore.confirm', 'Restore'),
            onPress: async () => {
              try {
                await privacyService.cancelDeletion();
                // Re-sync `me` so `deletedAt` clears locally after restoring.
                await refreshMe();
                Alert.alert(
                  t('privacy.restore.successTitle', 'Account restored'),
                  t('privacy.restore.successBody', 'Welcome back — your account is active again.'),
                );
              } catch {
                // Let the user try again on the next launch.
                promptedForRef.current = null;
                Alert.alert(
                  t('privacy.restore.errorTitle', "Couldn't restore"),
                  t('privacy.restore.errorBody', 'Something went wrong. Please try again.'),
                );
              }
            },
          },
        ],
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [status, userId, refreshMe, t]);

  return null;
};
