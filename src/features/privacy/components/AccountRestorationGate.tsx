import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../auth/store/authStore';

/**
 * RGPD deletion grace-period gate.
 *
 * Credential proof for a self-deleted account yields a signed recovery-only
 * session. Main navigation, extensions, push and realtime stay unmounted while
 * this component offers explicit restoration or a clean sign-out.
 *
 * Renders nothing — it only runs the check + shows the Alert. Mounted once, high
 * in the tree (RootNavigator), so it survives navigation.
 */
export const AccountRestorationGate: React.FC = () => {
  const { t } = useTranslation();
  const status = useAuthStore(s => s.status);
  const userId = useAuthStore(s => s.user?.id ?? null);
  const accountState = useAuthStore(s => s.user?.accountState ?? null);
  const recoveryScoped = useAuthStore(s => s.session?.scope === 'account_recovery');
  const restoreAccount = useAuthStore(s => s.restoreAccount);
  const signOut = useAuthStore(s => s.signOut);

  // Guard against re-prompting the same user twice within a session (the effect
  // re-runs on unrelated store changes, and cancellation refetches `me`).
  const promptedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      status !== 'restoration_required' ||
      !recoveryScoped ||
      (accountState !== null && accountState !== 'PENDING_DELETION')
    ) {
      // Reset outside recovery so a later deletion cycle for this account can
      // prompt again without requiring an app restart.
      if (status !== 'restoration_required') promptedForRef.current = null;
      return;
    }
    // A transient /users/me failure can leave the recovery session without a
    // profile. Restoration itself needs only the signed bearer, so use a stable
    // fallback key and never strand the user behind the Auth stack.
    const promptKey = userId ?? 'profile-unavailable-recovery-session';
    if (promptedForRef.current === promptKey) return;

    promptedForRef.current = promptKey;

    Alert.alert(
      t('privacy.restore.title', 'Account scheduled for deletion'),
      t(
        'privacy.restore.body',
        'Your account is being deleted. Would you like to restore it and keep your data?',
      ),
      [
        {
          text: t('privacy.restore.dismiss', 'Sign out'),
          style: 'cancel',
          onPress: () => void signOut(),
        },
        {
          text: t('privacy.restore.confirm', 'Restore'),
          onPress: async () => {
            try {
              await restoreAccount();
              Alert.alert(
                t('privacy.restore.successTitle', 'Account restored'),
                t('privacy.restore.successBody', 'Welcome back — your account is active again.'),
              );
            } catch {
              promptedForRef.current = null;
              Alert.alert(
                t('privacy.restore.errorTitle', "Couldn't restore"),
                t('privacy.restore.errorBody', 'Something went wrong. Please try again.'),
              );
            }
          },
        },
      ],
      { cancelable: false },
    );
  }, [accountState, recoveryScoped, restoreAccount, signOut, status, t, userId]);

  return null;
};
