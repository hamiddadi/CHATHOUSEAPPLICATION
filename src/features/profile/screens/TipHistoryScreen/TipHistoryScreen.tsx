import React, { memo, useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { colors, spacing } from '../../../../shared/constants/theme';
import { paymentsApi, type TipHistoryItem } from '../../../extensions';

// Stripe stores amounts in the currency's minor units (cents). Format back to
// the major unit using the device locale + ISO currency code.
const formatAmount = (minorUnits: number, currency: string): string => {
  const major = minorUnits / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(major);
  } catch {
    // Unknown/invalid currency code — fall back to a plain number + code.
    return `${major.toFixed(2)} ${currency.toUpperCase()}`;
  }
};

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

interface TipRowProps {
  item: TipHistoryItem;
}

const TipRow: React.FC<TipRowProps> = memo(({ item }) => {
  const { t } = useTranslation();
  const sent = item.direction === 'sent';
  const counterpartId = sent ? item.toUserId : item.fromUserId;
  return (
    <View className="flex-row items-center gap-md p-md rounded-md bg-overlay-white-5">
      <View
        style={[styles.iconWrap, sent ? styles.iconWrapSent : styles.iconWrapReceived]}
        accessibilityElementsHidden
      >
        <MaterialIcons
          name={sent ? 'north-east' : 'south-west'}
          size={18}
          color={sent ? colors.danger : colors.primary}
        />
      </View>
      <View className="flex-1">
        <Text className="text-md font-body-bold text-ink">
          {sent ? t('tipHistory.sent', 'Tip sent') : t('tipHistory.received', 'Tip received')}
        </Text>
        <Text className="text-xs font-body text-ink-muted">
          {t('tipHistory.counterpart', { id: counterpartId.slice(0, 8) })}
          {' · '}
          {formatDate(item.createdAt)}
        </Text>
      </View>
      <Text
        style={sent ? styles.amountSent : styles.amountReceived}
        className="text-md font-body-bold"
      >
        {sent ? '-' : '+'}
        {formatAmount(item.amount, item.currency)}
      </Text>
    </View>
  );
});
TipRow.displayName = 'TipRow';

/**
 * Tip history (Vague 7 monetization). Lists the user's confirmed tips — sent and
 * received — newest first, via `paymentsApi.tipHistory()`. Mirrors the
 * Loader / EmptyState / FlatList shape of the sibling FollowersScreen.
 */
export const TipHistoryScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const tipsQuery = useQuery({
    queryKey: ['ext', 'payments', 'tips'],
    queryFn: () => paymentsApi.tipHistory(),
    staleTime: 30_000,
  });

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);
  const handleRefresh = useCallback(() => {
    void tipsQuery.refetch();
  }, [tipsQuery]);

  const renderItem = useCallback(
    ({ item }: { item: TipHistoryItem }) => <TipRow item={item} />,
    [],
  );
  const keyExtractor = useCallback((item: TipHistoryItem) => item.id, []);
  const renderSeparator = useCallback(() => <View className="h-sm" />, []);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-md px-xxl py-lg">
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', 'Back')}
          hitSlop={8}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-lg font-headline text-ink">
          {t('tipHistory.title', 'Tip history')}
        </Text>
      </View>

      {tipsQuery.isLoading ? (
        <Loader fullscreen accessibilityLabel={t('tipHistory.loading', 'Loading tips')} />
      ) : tipsQuery.isError ? (
        <EmptyState
          title={t('tipHistory.loadError', "Couldn't load tips")}
          description={t('tipHistory.pleaseTryAgain', 'Please try again.')}
        />
      ) : (
        <FlatList
          data={tipsQuery.data ?? []}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ItemSeparatorComponent={renderSeparator}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.giant }]}
          refreshing={tipsQuery.isRefetching}
          onRefresh={handleRefresh}
          ListEmptyComponent={
            <EmptyState
              title={t('tipHistory.empty', 'No tips yet')}
              description={t(
                'tipHistory.emptyHint',
                'Tips you send and receive will show up here.',
              )}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.xxl, flexGrow: 1 },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapSent: { backgroundColor: 'rgba(239, 68, 68, 0.12)' },
  iconWrapReceived: { backgroundColor: colors.overlayWhite4 },
  amountSent: { color: colors.danger },
  amountReceived: { color: colors.primary },
});
