import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '../../../shared/constants/theme';
import { errorMessage } from '../../../shared/utils/errorMessage';
import type { UserSummary } from '../../../shared/types/domain';
import { useTip } from '../hooks/useTip';

const PRESETS = [2, 5, 10, 20];
const CURRENCIES = [
  { code: 'eur', symbol: '€' },
  { code: 'usd', symbol: '$' },
  { code: 'gbp', symbol: '£' },
] as const;

interface ExtTipSheetProps {
  /** When null the sheet is hidden. */
  target: UserSummary | null;
  onClose: () => void;
  /** Called after the Checkout URL is opened. */
  onSent?: () => void;
}

/**
 * Bottom sheet to tip a creator. Amount preset + currency → opens a Stripe
 * Checkout URL in the browser (no card data touches the app). The Tip ledger is
 * recorded server-side by the webhook on payment success.
 */
export const ExtTipSheet: React.FC<ExtTipSheetProps> = ({ target, onClose, onSent }) => {
  const { t } = useTranslation();
  const tip = useTip();
  const [currency, setCurrency] = useState<string>('eur');

  const handleTip = useCallback(
    (amountMajor: number) => {
      if (!target) return;
      tip.mutate(
        { toUserId: target.id, amountCents: amountMajor * 100, currency },
        {
          onSuccess: ({ url }) => {
            Linking.openURL(url).catch(() => {
              Alert.alert(t('tip.errorTitle'), t('tip.openError'));
            });
            onSent?.();
          },
          onError: e => Alert.alert(t('tip.errorTitle'), errorMessage(e, t('tip.genericError'))),
        },
      );
    },
    [tip, target, currency, t, onSent],
  );

  const symbol = CURRENCIES.find(c => c.code === currency)?.symbol ?? '';

  return (
    <Modal visible={target !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('common.close', 'Fermer')}
      >
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.handle} />
          <Text style={styles.title}>
            {t('tip.title', {
              name: target?.displayName ?? target?.username ?? '',
              defaultValue: 'Envoyer un pourboire',
            })}
          </Text>
          <Text style={styles.subtitle}>{t('tip.subtitle')}</Text>

          <View style={styles.currencyRow}>
            {CURRENCIES.map(c => (
              <Pressable
                key={c.code}
                onPress={() => setCurrency(c.code)}
                accessibilityRole="button"
                accessibilityState={{ selected: currency === c.code }}
                style={[styles.currencyChip, currency === c.code ? styles.currencyChipOn : null]}
              >
                <Text style={currency === c.code ? styles.currencyTextOn : styles.currencyText}>
                  {c.symbol} {c.code.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.presetRow}>
            {PRESETS.map(p => (
              <Pressable
                key={p}
                onPress={() => handleTip(p)}
                disabled={tip.isPending}
                accessibilityRole="button"
                accessibilityLabel={`${symbol}${p}`}
                style={styles.preset}
              >
                <Text style={styles.presetText}>
                  {symbol}
                  {p}
                </Text>
              </Pressable>
            ))}
          </View>

          {tip.isPending ? (
            <ActivityIndicator color={colors.primary} style={styles.spinner} />
          ) : null}

          <Pressable
            onPress={onClose}
            style={styles.cancel}
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel', 'Annuler')}
          >
            <Text style={styles.cancelLabel}>{t('common.cancel', 'Annuler')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surfaceHigh,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.xxl,
    gap: spacing.md,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginBottom: spacing.sm,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: 13 },
  currencyRow: { flexDirection: 'row', gap: spacing.sm },
  currencyChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 9999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  currencyChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  currencyText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  currencyTextOn: { color: colors.onPrimary, fontSize: 13, fontWeight: '700' },
  presetRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  preset: {
    flexGrow: 1,
    minWidth: 70,
    alignItems: 'center',
    paddingVertical: spacing.lg,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  presetText: { color: colors.text, fontSize: 18, fontWeight: '700' },
  spinner: { marginTop: spacing.sm },
  cancel: {
    marginTop: spacing.sm,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  cancelLabel: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
});
