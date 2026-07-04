import React, { memo, useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../../../shared/components/Button';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { Loader } from '../../../../shared/components/Loader';
import { useApiErrorToast } from '../../../../shared/hooks/useApiErrorToast';
import { colors, spacing, radii, fontSizes } from '../../../../shared/constants/theme';
import { clubsListApi } from '../../../extensions/api/clubsListApi';
import type { FrequencyTier } from '../../../extensions/api/notifPrefsExtApi';
import { NOTIF_PREF_KEYS, type NotifPrefs } from '../../services/notifPrefsService';
import { useNotifPrefs, useUpdateNotifPrefs } from '../../hooks/useNotifPrefs';
import {
  useNotifPrefsExt,
  useSetNotifFrequency,
  useToggleMutedClub,
  useUnmuteUser,
} from '../../hooks/useNotifPrefsExt';

type PrefKey = keyof NotifPrefs;

const FREQUENCY_TIERS: readonly FrequencyTier[] = ['infrequent', 'normal', 'frequent'];

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

interface FrequencySelectorProps {
  value: FrequencyTier;
  disabled: boolean;
  onSelect: (tier: FrequencyTier) => void;
}

const FrequencySelector: React.FC<FrequencySelectorProps> = memo(
  ({ value, disabled, onSelect }) => {
    const { t } = useTranslation();
    return (
      <View style={styles.segment}>
        {FREQUENCY_TIERS.map(tier => {
          const active = tier === value;
          return (
            <Pressable
              key={tier}
              onPress={() => onSelect(tier)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled }}
              accessibilityLabel={t(`notificationSettings.frequency.${tier}`)}
              style={[styles.segmentItem, active ? styles.segmentItemActive : null]}
            >
              <Text style={active ? styles.segmentTextActive : styles.segmentText}>
                {t(`notificationSettings.frequency.${tier}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  },
);
FrequencySelector.displayName = 'FrequencySelector';

interface MuteRowProps {
  id: string;
  label: string;
  muted: boolean;
  disabled: boolean;
  onToggle: (id: string, muted: boolean) => void;
}

const MuteRow: React.FC<MuteRowProps> = memo(({ id, label, muted, disabled, onToggle }) => {
  const handleChange = useCallback((next: boolean) => onToggle(id, next), [id, onToggle]);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel} numberOfLines={1}>
        {label}
      </Text>
      <Switch
        value={muted}
        onValueChange={handleChange}
        disabled={disabled}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityState={{ checked: muted, disabled }}
        trackColor={{ false: colors.overlayWhite15, true: colors.primaryContainer }}
        thumbColor={colors.white}
        ios_backgroundColor={colors.overlayWhite15}
      />
    </View>
  );
});
MuteRow.displayName = 'MuteRow';

export const NotificationSettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { data: prefs, isLoading, isError, refetch } = useNotifPrefs();
  const updatePrefs = useUpdateNotifPrefs();
  // Localized toast on any mutation failure. The hooks already roll the
  // optimistic switch back on error; without this the switch reverts with no
  // explanation (audit QA 2026-07-02).
  const showErrorToast = useApiErrorToast();

  // Extended prefs (frequency tier + per-club / per-user mute). Resolve the
  // user's own clubs so muted-club ids render as names; clubs they belong to
  // can also be muted from here. Failure to load the club list just leaves
  // the mute list keyed by id (graceful — never blocks the toggles).
  const { data: extPrefs } = useNotifPrefsExt();
  const { data: myClubs } = useQuery({
    queryKey: ['ext', 'clubs', 'mine'],
    queryFn: () => clubsListApi.myClubs(),
    staleTime: 60_000,
  });
  const setFrequency = useSetNotifFrequency();
  const toggleMutedClub = useToggleMutedClub();
  const unmuteUser = useUnmuteUser();

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

  const onMutationError = useCallback(
    (err: unknown) => {
      showErrorToast(err);
    },
    [showErrorToast],
  );

  const handleToggle = useCallback(
    (key: PrefKey, value: boolean) => {
      updatePrefs.mutate({ [key]: value }, { onError: onMutationError });
    },
    [updatePrefs, onMutationError],
  );

  const handleSelectFrequency = useCallback(
    (tier: FrequencyTier) => setFrequency.mutate(tier, { onError: onMutationError }),
    [setFrequency, onMutationError],
  );

  const handleToggleClub = useCallback(
    (clubId: string, muted: boolean) =>
      toggleMutedClub.mutate({ clubId, muted }, { onError: onMutationError }),
    [toggleMutedClub, onMutationError],
  );

  // The user mute list only offers UN-mute (muting a user happens from their
  // profile). Toggling the switch off (muted=false) drops them from the set.
  const handleUnmuteUser = useCallback(
    (userId: string, muted: boolean) => {
      if (!muted) unmuteUser.mutate(userId, { onError: onMutationError });
    },
    [unmuteUser, onMutationError],
  );

  // Only the row whose write is in flight is disabled (not every switch). React
  // Query exposes the last-submitted variable on `.variables` while pending, so
  // we derive the touched key/id from it rather than freezing the whole screen.
  const pendingPrefKey =
    updatePrefs.isPending && updatePrefs.variables
      ? (Object.keys(updatePrefs.variables)[0] as PrefKey | undefined)
      : undefined;
  const pendingClubId = toggleMutedClub.isPending ? toggleMutedClub.variables?.clubId : undefined;
  const pendingUserId = unmuteUser.isPending ? unmuteUser.variables : undefined;

  // Union of the user's clubs and any muted-club id that isn't in that list
  // (a club they left while keeping the mute). Names resolve from the club
  // list; orphan ids fall back to a short id label.
  const mutedClubSet = useMemo(() => new Set(extPrefs?.mutedClubs ?? []), [extPrefs?.mutedClubs]);
  const clubRows = useMemo(() => {
    const known = myClubs ?? [];
    const knownIds = new Set(known.map(c => c.id));
    const rows = known.map(c => ({ id: c.id, name: c.name }));
    for (const id of extPrefs?.mutedClubs ?? []) {
      if (!knownIds.has(id)) rows.push({ id, name: id.slice(0, 8) });
    }
    return rows;
  }, [myClubs, extPrefs?.mutedClubs]);

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
              disabled={pendingPrefKey === key}
              onToggle={handleToggle}
            />
          ))}

          {/* Extended prefs — frequency tier throttles push fan-out; per-club /
              per-user mutes silence pushes from a source. The in-app bell is
              never affected (only the push). */}
          <Text style={styles.sectionTitle}>{t('notificationSettings.frequency.heading')}</Text>
          <Text style={styles.subtitle}>{t('notificationSettings.frequency.subtitle')}</Text>
          <FrequencySelector
            value={extPrefs?.frequency ?? 'normal'}
            disabled={!extPrefs || setFrequency.isPending}
            onSelect={handleSelectFrequency}
          />

          {clubRows.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>
                {t('notificationSettings.mutedClubs.heading')}
              </Text>
              <Text style={styles.subtitle}>{t('notificationSettings.mutedClubs.subtitle')}</Text>
              {clubRows.map(club => (
                <MuteRow
                  key={club.id}
                  id={club.id}
                  label={club.name}
                  muted={mutedClubSet.has(club.id)}
                  disabled={!extPrefs || pendingClubId === club.id}
                  onToggle={handleToggleClub}
                />
              ))}
            </>
          ) : null}

          {extPrefs && extPrefs.mutedUsers.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>
                {t('notificationSettings.mutedUsers.heading')}
              </Text>
              <Text style={styles.subtitle}>{t('notificationSettings.mutedUsers.subtitle')}</Text>
              {extPrefs.mutedUsers.map(userId => (
                <MuteRow
                  key={userId}
                  id={userId}
                  // No batch user-lookup endpoint exists yet, so a raw id is the
                  // only identity available. "Muted person · <short id>" reads
                  // better than a bare 8-char hex fragment while keeping each row
                  // distinguishable. DEFERRED: resolve real display names once a
                  // /users/by-ids endpoint + profileService.getUsersByIds are
                  // added (audit QA 2026-07-02).
                  label={`${t('notificationSettings.mutedUsers.userFallback', 'Muted person')} · ${userId.slice(0, 8)}`}
                  muted
                  disabled={pendingUserId === userId}
                  onToggle={handleUnmuteUser}
                />
              ))}
            </>
          ) : null}
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
  sectionTitle: {
    color: colors.text,
    fontSize: fontSizes.md,
    fontWeight: '700',
    marginTop: spacing.xl,
    marginBottom: spacing.xxs,
  },
  segment: {
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.xxs,
    borderRadius: radii.md,
    backgroundColor: colors.overlayWhite4,
    borderWidth: 1,
    borderColor: colors.glassStrong,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radii.sm,
  },
  segmentItemActive: {
    backgroundColor: colors.primaryContainer,
  },
  segmentText: {
    color: colors.textMuted,
    fontSize: fontSizes.sm,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: colors.white,
    fontSize: fontSizes.sm,
    fontWeight: '700',
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
