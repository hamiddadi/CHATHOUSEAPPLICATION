import React, { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import { useRecentReplays } from '../../hooks/useRecordings';
import type { Replay } from '../../services/recordingService';
import ReplayPlayer from '../../components/ReplayPlayer';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'Replays'>;

const relativeDate = (iso: string): string => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours >= 1) return `${hours}h`;
  const mins = Math.floor(diffMs / 60_000);
  return `${Math.max(1, mins)}m`;
};

export const ReplaysScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { data: replays, isLoading } = useRecentReplays();

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

  const renderItem = useCallback(
    ({ item }: { item: Replay }) => {
      const hostName = item.host?.displayName || item.host?.username || '';
      const meta = hostName
        ? `${hostName} · ${relativeDate(item.createdAt)}`
        : relativeDate(item.createdAt);
      return (
        <View style={styles.card}>
          <Text className="text-md font-body-bold text-ink" numberOfLines={1}>
            {item.roomTitle ?? t('replays.untitled')}
          </Text>
          <Text className="text-xs font-body text-ink-muted mb-sm">{meta}</Text>
          <ReplayPlayer url={item.fileUrl} durationMs={item.durationMs} />
        </View>
      );
    },
    [t],
  );

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-md px-xxl py-md">
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', 'Back')}
          hitSlop={8}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-xxl font-display text-ink tracking-tight">{t('replays.title')}</Text>
      </View>

      {isLoading ? (
        <Loader fullscreen accessibilityLabel={t('common.loading')} />
      ) : (
        <FlatList
          data={replays ?? []}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          contentContainerStyle={{
            padding: spacing.xxl,
            gap: spacing.md,
            paddingBottom: insets.bottom + spacing.huge,
          }}
          ListEmptyComponent={
            <EmptyState title={t('replays.emptyTitle')} description={t('replays.emptyBody')} />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: spacing.lg,
    gap: spacing.xs,
  },
});
