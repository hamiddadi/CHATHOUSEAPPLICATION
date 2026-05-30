import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { clubsListApi, type ClubLite } from '../api/clubsListApi';

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

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    clubsListApi
      .myClubs()
      .then(items => {
        if (!cancelled) setClubs(items);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={e => e.stopPropagation()}>
          <View style={styles.handle} />
          <Text style={styles.title}>Start in a Club</Text>
          <Text style={styles.subtitle}>The room will appear on the Club page.</Text>

          {loading ? (
            <ActivityIndicator style={styles.loader} />
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
              ListEmptyComponent={
                <Text style={styles.empty}>You don't belong to any Club yet.</Text>
              }
            />
          )}

          <Pressable style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
    maxHeight: '80%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
  },
  loader: { marginVertical: 24 },
  title: { fontSize: 18, fontWeight: '700', marginTop: 12 },
  subtitle: { color: '#64748B', marginTop: 2, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#F1F5F9',
  },
  rowActive: { backgroundColor: '#EFF6FF' },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  iconFallback: { backgroundColor: '#1F2937' },
  iconNone: { backgroundColor: '#E2E8F0' },
  iconText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  body: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12, color: '#64748B', marginTop: 1 },
  check: { fontSize: 18, color: '#2A8BF2', fontWeight: '700' },
  empty: { textAlign: 'center', color: '#94A3B8', paddingVertical: 24 },
  cancel: { marginTop: 8, paddingVertical: 12, alignItems: 'center' },
  cancelText: { fontSize: 15, color: '#475569' },
});
