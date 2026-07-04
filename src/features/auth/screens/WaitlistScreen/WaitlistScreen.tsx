import React, { useCallback } from 'react';
import { Share, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../../shared/components/Button';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { AuthStackParamList } from '../../../../core/navigation/types';

const HOURGLASS_SIZE = 72;

export const WaitlistScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  // This screen is only reachable via deep link today, so it can be the
  // stack's first route: goBack() would then be a silent no-op — fall back
  // to Landing instead of leaving the user stranded.
  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Landing');
  }, [navigation]);

  const handleInvite = useCallback(async () => {
    try {
      await Share.share({
        message: t(
          'auth.waitlist.shareMessage',
          "I'm waiting for my Chathouse access — join the waitlist to help me move up: https://app.chathouse.com",
        ),
        url: 'https://app.chathouse.com',
      });
    } catch {
      /* user cancelled — no-op */
    }
  }, [t]);

  return (
    <View
      className="flex-1 bg-background items-center justify-between px-xxl"
      style={{
        paddingTop: insets.top + spacing.huge,
        paddingBottom: insets.bottom + spacing.huge,
      }}
    >
      <View className="items-center gap-md flex-1 justify-center">
        <View className="w-[140px] h-[140px] rounded-pill bg-overlay-white-10 items-center justify-center">
          <MaterialIcons name="hourglass-empty" size={HOURGLASS_SIZE} color={colors.primary} />
        </View>
        <Text className="text-display font-display text-ink tracking-tight text-center">
          {t('auth.waitlist.title', "You're on the waitlist")}
        </Text>
        <Text className="text-sm font-body text-ink-muted text-center max-w-[300px]">
          {t(
            'auth.waitlist.subtitle',
            "We'll let you know the moment a spot opens up. In the meantime, invite a friend to move up the queue.",
          )}
        </Text>
      </View>

      <View className="w-full gap-sm">
        <Button
          label={t('auth.waitlist.invite', 'Invite a friend')}
          variant="primary"
          size="lg"
          fullWidth
          onPress={handleInvite}
        />
        <Button
          label={t('common.back', 'Back')}
          variant="ghost"
          size="md"
          fullWidth
          onPress={handleBack}
        />
      </View>
    </View>
  );
};
