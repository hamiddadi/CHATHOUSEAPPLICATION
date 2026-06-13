import React, { memo, useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../../shared/components/Button';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { Loader } from '../../../../shared/components/Loader';
import { colors, spacing, radii, fontSizes } from '../../../../shared/constants/theme';
import { NOTIF_PREF_KEYS, type NotifPrefs } from '../../services/notifPrefsService';
import { useNotifPrefs, useUpdateNotifPrefs } from '../../hooks/useNotifPrefs';

type PrefKey = keyof NotifPrefs;

interface RowProps {
  prefKey: PrefKey;
  label: string;
  value: boolean;
  disabled: boolean;
  onToggle: (key: PrefKey, value: boolean) => void;
}

const PrefRow: React.FC<RowProps> = memo(({ prefKey, label, value, disabled, onToggle }) => {
  const handleChange = useCallback((next: boolean) => onToggle(prefKey, next), [onToggle, prefKey]);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={handleChange}
        disabled={disabled}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityState={{ checked: value, disabled }}
        trackColor={{ false: colors.overlayWhite15, true: colors.primaryContainer }}
        thumbColor={colors.white}
        ios_backgroundColor={colors.overlayWhite15}
      />
    </View>
  );
});
PrefRow.displayName = 'PrefRow';

export const NotificationSettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { data: prefs, isLoading, isError, refetch } = useNotifPrefs();
  const updatePrefs = useUpdateNotifPrefs();

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

  const handleToggle = useCallback(
    (key: PrefKey, value: boolean) => {
      updatePrefs.mutate({ [key]: value });
    },
    [updatePrefs],
  );

  const handleRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-xxl py-lg gap-md">
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={8}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-lg font-headline text-ink">{t('notificationSettings.title')}</Text>
      </View>

      {isLoading ? (
        <Loader fullscreen accessibilityLabel={t('notificationSettings.title')} />
      ) : isError || !prefs ? (
        <EmptyState title={t('common.error')}>
          <Button label={t('common.retry')} variant="outline" size="md" onPress={handleRetry} />
        </EmptyState>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: spacing.xxl,
            paddingBottom: insets.bottom + spacing.giant,
            gap: spacing.sm,
          }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.subtitle}>{t('notificationSettings.subtitle')}</Text>
          {NOTIF_PREF_KEYS.map(key => (
            <PrefRow
              key={key}
              prefKey={key}
              label={t(`notificationSettings.${key}`)}
              value={prefs[key]}
              disabled={updatePrefs.isPending}
              onToggle={handleToggle}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  subtitle: {
    color: colors.textMuted,
    fontSize: fontSizes.sm,
    lineHeight: 19,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.overlayWhite4,
    borderWidth: 1,
    borderColor: colors.glassStrong,
  },
  rowLabel: {
    flex: 1,
    color: colors.text,
    fontSize: fontSizes.md,
    fontWeight: '600',
  },
});
