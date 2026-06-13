import React, { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../../shared/components/Button';
import { colors, spacing } from '../../../../shared/constants/theme';
import { pushService } from '../../../notifications/services/pushService';
import type { OnboardingStackScreenProps } from '../../../../core/navigation/types';

type Nav = OnboardingStackScreenProps<'NotificationsPermission'>['navigation'];

/**
 * Onboarding step asking the user to enable push notifications (Clubhouse
 * "Turn on notifications"). "Enable" triggers the OS permission prompt via
 * pushService and registers the token; "Not now" skips. Both advance to the
 * final SuggestedFollows step. The request is a no-op (no prompt) in Expo Go /
 * on web / simulator, so the flow never blocks there.
 */
const BENEFITS: { icon: React.ComponentProps<typeof MaterialIcons>['name']; key: string }[] = [
  { icon: 'mic', key: 'roomsStarted' },
  { icon: 'chat-bubble', key: 'messages' },
  { icon: 'person-add', key: 'follows' },
];

export const NotificationsPermissionScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [requesting, setRequesting] = useState(false);

  const goNext = useCallback(() => navigation.navigate('SuggestedFollows'), [navigation]);

  const handleEnable = useCallback(async () => {
    setRequesting(true);
    try {
      // Requests OS permission (once) and registers the token with the backend.
      // Idempotent and safe to call even if already granted.
      await pushService.registerWithBackend();
    } catch {
      /* ignore — never block onboarding on a permission/registration failure */
    } finally {
      setRequesting(false);
      goNext();
    }
  }, [goNext]);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top + spacing.xl }}>
      <View
        className="flex-1 px-xxl gap-xxl"
        style={{ paddingBottom: insets.bottom + spacing.huge }}
      >
        <View className="items-center gap-md mt-huge">
          <View className="w-20 h-20 rounded-full bg-primary/15 items-center justify-center">
            <MaterialIcons name="notifications-active" size={40} color={colors.primary} />
          </View>
          <Text className="text-display font-display text-ink tracking-tight text-center">
            {t('onboarding.notifications.title', 'Stay in the loop')}
          </Text>
          <Text className="text-md text-ink-muted text-center">
            {t(
              'onboarding.notifications.subtitle',
              'Get notified when your friends go live, message you, or follow you.',
            )}
          </Text>
        </View>

        <View className="gap-lg mt-lg">
          {BENEFITS.map(b => (
            <View key={b.key} className="flex-row items-center gap-md">
              <View className="w-10 h-10 rounded-full bg-overlay-white-5 items-center justify-center">
                <MaterialIcons name={b.icon} size={20} color={colors.primary} />
              </View>
              <Text className="text-sm font-body text-ink flex-1">
                {t(`onboarding.notifications.benefits.${b.key}`)}
              </Text>
            </View>
          ))}
        </View>

        <View className="flex-1" />

        <View className="gap-md">
          <Button
            label={t('onboarding.notifications.enable', 'Enable notifications')}
            variant="primary"
            size="lg"
            fullWidth
            loading={requesting}
            disabled={requesting}
            onPress={handleEnable}
          />
          <Pressable
            onPress={goNext}
            accessibilityRole="button"
            disabled={requesting}
            className="items-center py-sm"
          >
            <Text className="text-md text-ink-muted">
              {t('onboarding.notifications.notNow', 'Not now')}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};
