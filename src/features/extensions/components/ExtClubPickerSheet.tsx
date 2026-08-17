import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { clubsListApi, type ClubLite } from '../api/clubsListApi';
import { colors } from '../../../shared/constants/theme';
import { ExtBottomSheet } from './ExtBottomSheet';

interface Props {
  visible: boolean;
  onSelect: (club: ClubLite | null) => void;
  onClose: () => void;
  /** When set, highlights the currently chosen club. */
  selectedClubId?: string | null;
}

/**
 * Modal sheet that lets the host pick a Club when starting a new room
 * (Module 4.7 / ROOM-CREATE-012). Includes a "No club" option so the
 * room can stay personal. Pure additive — caller decides when to mount.
 */
export const ExtClubPickerSheet: React.FC<Props> = ({
  visible,
  onSelect,
  onClose,
  selectedClubId,
}) => {
  const [clubs, setClubs] = useState<ClubLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    clubsListApi
      .myClubs()
      .then(items => {
        if (!cancelled) setClubs(items);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [retryAttempt, visible]);

  return (
    <ExtBottomSheet visible={visible} onClose={onClose} sheetStyle={styles.sheet}>
      <Text style={styles.title}>Start in a Club</Text>
      <Text style={styles.subtitle}>The room will appear on the Club page.</Text>

      {loading ? (
        <ActivityIndicator
          style={styles.loader}
          color={colors.primary}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading Clubs"
        />
      ) : loadError ? (
        <View style={styles.errorState}>
          <Text style={styles.error} accessibilityRole="alert">
            Couldn't load your Clubs.
          </Text>
          <Pressable
            style={styles.retry}
            onPress={() => setRetryAttempt(attempt => attempt + 1)}
            accessibilityRole="button"
            accessibilityLabel="Retry"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={[null, ...clubs] as (ClubLite | null)[]}
          keyExtractor={(c, i) => c?.id ?? `none-${i}`}
          renderItem={({ item }) => {
            const isSelected =
              (item === null && (selectedClubId === null || selectedClubId === undefined)) ||
              (item !== null && selectedClubId === item.id);
            return (
              <Pressable
                style={[styles.row, isSelected && styles.rowActive]}
                onPress={() => {
                  onSelect(item);
                  onClose();
                }}
                accessibilityRole="radio"
                accessibilityLabel={item?.name ?? 'No Club (personal room)'}
                accessibilityState={{ selected: isSelected }}
              >
                {item ? (
                  item.iconUrl ? (
                    <Image source={{ uri: item.iconUrl }} style={styles.icon} />
                  ) : (
                    <View style={[styles.icon, styles.iconFallback]}>
                      <Text style={styles.iconText}>{item.name.slice(0, 1).toUpperCase()}</Text>
                    </View>
                  )
                ) : (
                  <View style={[styles.icon, styles.iconNone]}>
                    <Text style={styles.iconText}>—</Text>
                  </View>
                )}
                <View style={styles.body}>
                  <Text style={styles.name}>{item?.name ?? 'No Club (personal room)'}</Text>
                  {item ? (
                    <Text style={styles.meta} numberOfLines={1}>
                      {item.memberCount} members • {item.privacy}
                    </Text>
                  ) : null}
                </View>
                {isSelected ? <Text style={styles.check}>✓</Text> : null}
              </Pressable>
            );
          }}
          ListFooterComponent={
            clubs.length === 0 ? (
              <Text style={styles.empty}>You don't belong to any Club yet.</Text>
            ) : null
          }
        />
      )}

      <Pressable
        style={styles.cancel}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Cancel"
      >
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </ExtBottomSheet>
  );
};

const styles = StyleSheet.create({
  sheet: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
    maxHeight: '80%',
  },
  loader: { marginVertical: 24 },
  errorState: { alignItems: 'center', gap: 12, paddingVertical: 16 },
  error: { color: colors.danger, textAlign: 'center' },
  retry: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  retryText: { color: colors.onPrimary, fontWeight: '600', fontSize: 15 },
  title: { fontSize: 18, fontWeight: '700', marginTop: 12, color: colors.text },
  subtitle: { color: colors.textMuted, marginTop: 2, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassStrong,
  },
  rowActive: { backgroundColor: colors.overlayWhite10 },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  iconFallback: { backgroundColor: colors.surfaceHigh },
  iconNone: { backgroundColor: colors.surfaceHigh },
  iconText: { color: colors.textMuted, fontWeight: '700', fontSize: 16 },
  body: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  check: { fontSize: 18, color: colors.primary, fontWeight: '700' },
  empty: { textAlign: 'center', color: colors.textDim, paddingVertical: 24 },
  cancel: { minHeight: 44, marginTop: 8, paddingVertical: 12, alignItems: 'center' },
  cancelText: { fontSize: 15, color: colors.textMuted },
});
