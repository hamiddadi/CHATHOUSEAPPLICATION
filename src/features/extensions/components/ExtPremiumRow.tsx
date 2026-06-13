import React, { useCallback } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, withAlpha } from '../../../shared/constants/theme';
import { errorMessage } from '../../../shared/utils/errorMessage';
import { STRIPE_HOSTS, openExternalUrl } from '../../../shared/utils/openExternalUrl';
import {
  useOpenBillingPortal,
  usePremiumStatus,
  useStartPremiumCheckout,
} from '../hooks/usePremium';

/**
 * Settings entry for ChatHouse Premium. Subscribe (Stripe Checkout) when free,
 * manage/cancel (billing portal) when premium — both open a hosted URL. Renders
 * nothing when premium isn't configured server-side (Stripe off).
 */
export const ExtPremiumRow: React.FC = () => {
  const { t } = useTranslation();
  const { data: status } = usePremiumStatus();
  const checkout = useStartPremiumCheckout();
  const portal = useOpenBillingPortal();

  const open = useCallback(
    (url: string) => {
      void openExternalUrl(url, STRIPE_HOSTS).then(ok => {
        if (!ok) Alert.alert(t('premium.errorTitle'), t('premium.openError'));
      });
    },
    [t],
  );

  const handleSubscribe = useCallback(() => {
    checkout.mutate(undefined, {
      onSuccess: ({ url }) => open(url),
      onError: e =>
        Alert.alert(t('premium.errorTitle'), errorMessage(e, t('premium.genericError'))),
    });
  }, [checkout, open, t]);

  const handleManage = useCallback(() => {
    portal.mutate(undefined, {
      onSuccess: ({ url }) => open(url),
      onError: e =>
        Alert.alert(t('premium.errorTitle'), errorMessage(e, t('premium.genericError'))),
    });
  }, [portal, open, t]);

  // Hidden unless premium is configured on the backend.
  if (!status?.configured) return null;

  const premium = status.premium;
  const busy = checkout.isPending || portal.isPending;

  return (
    <Pressable
      onPress={premium ? handleManage : handleSubscribe}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={premium ? t('premium.manage') : t('premium.subscribe')}
      style={styles.row}
    >
      <View style={styles.icon}>
        <MaterialIcons name="workspace-premium" size={20} color={colors.primary} />
      </View>
      <View style={styles.body}>
        <Text style={styles.label}>
          {premium ? t('premium.activeTitle') : t('premium.upsellTitle')}
        </Text>
        <Text style={styles.hint}>
          {premium ? t('premium.manageHint') : t('premium.upsellHint')}
        </Text>
      </View>
      {busy ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <MaterialIcons name="chevron-right" size={22} color={colors.textMuted} />
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: withAlpha(colors.primary, 0.08),
    borderWidth: 1,
    borderColor: withAlpha(colors.primary, 0.3),
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: withAlpha(colors.primary, 0.15),
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1 },
  label: { color: colors.text, fontSize: 15, fontWeight: '700' },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
