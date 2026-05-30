import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRoute, useNavigation, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../../../shared/components/Avatar';
import { Button } from '../../../../shared/components/Button';
import { Input } from '../../../../shared/components/Input';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { Loader } from '../../../../shared/components/Loader';
import { colors, spacing } from '../../../../shared/constants/theme';
import { searchService } from '../../../search/services/searchService';
import { useInviteToRoom } from '../../hooks/useRooms';
import { errorMessage } from '../../../../shared/utils/errorMessage';
import type { RoomStackParamList } from '../../../../core/navigation/types';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'InviteToRoom'>;
type Route = RouteProp<RoomStackParamList, 'InviteToRoom'>;

interface Candidate {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

const SEARCH_DEBOUNCE_MS = 250;
const MAX_INVITEES = 50;

export const InviteToRoomScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { roomId } = route.params;

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Candidate[]>([]);
  const invite = useInviteToRoom();

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    if (debounced.length === 0) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    void searchService
      .users(debounced, 20)
      .then(rows => {
        if (cancelled) return;
        setResults(
          rows.map(r => ({
            id: r.id,
            username: r.username,
            displayName: r.displayName,
            avatarUrl: r.avatarUrl,
          })),
        );
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const toggle = useCallback((c: Candidate) => {
    setSelected(prev => {
      const idx = prev.findIndex(p => p.id === c.id);
      if (idx >= 0) return prev.filter(p => p.id !== c.id);
      if (prev.length >= MAX_INVITEES) return prev;
      return [...prev, c];
    });
  }, []);

  const handleSend = useCallback(() => {
    if (selected.length === 0) return;
    invite.mutate(
      { roomId, userIds: selected.map(c => c.id) },
      {
        onSuccess: r => {
          Alert.alert('Invitations envoyées', `${r.invitedCount} personne(s) notifiée(s).`);
          navigation.goBack();
        },
        onError: e => Alert.alert('Erreur', errorMessage(e, 'Échec')),
      },
    );
  }, [invite, navigation, roomId, selected]);

  const selectedIds = useMemo(() => new Set(selected.map(s => s.id)), [selected]);

  const renderItem = useCallback(
    ({ item }: { item: Candidate }) => {
      const isOn = selectedIds.has(item.id);
      return (
        <Pressable
          onPress={() => toggle(item)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isOn }}
          style={styles.row}
        >
          <Avatar
            uri={item.avatarUrl ?? undefined}
            name={item.displayName ?? item.username ?? '?'}
            sizeValue={36}
          />
          <View style={styles.candidateInfo}>
            <Text style={styles.displayName}>{item.displayName || item.username}</Text>
            <Text style={styles.username}>@{item.username}</Text>
          </View>
          <View style={[styles.checkbox, isOn ? styles.checkboxOn : styles.checkboxOff]}>
            {isOn ? <MaterialIcons name="check" size={16} color={colors.background} /> : null}
          </View>
        </Pressable>
      );
    },
    [selectedIds, toggle],
  );

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top + spacing.lg }}>
      <View className="px-xxl gap-md">
        <View className="flex-row items-center justify-between">
          <Text className="text-2xl font-display text-white">Inviter</Text>
          <Pressable
            onPress={navigation.goBack}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Fermer"
          >
            <MaterialIcons name="close" size={22} color={colors.text} />
          </Pressable>
        </View>
        <Input
          placeholder="Rechercher des utilisateurs"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          leftAdornment={<MaterialIcons name="search" size={18} color={colors.textMuted} />}
        />
        {selected.length > 0 ? (
          <Text style={styles.selectedCount}>
            {selected.length} sélectionné·e·s · max {MAX_INVITEES}
          </Text>
        ) : null}
      </View>

      {searching && results.length === 0 ? (
        <Loader fullscreen accessibilityLabel="Recherche…" />
      ) : (
        <FlatList
          data={results}
          renderItem={renderItem}
          keyExtractor={r => r.id}
          ItemSeparatorComponent={() => <View style={{ height: spacing.xs }} />}
          contentContainerStyle={{
            paddingHorizontal: spacing.xxl,
            paddingTop: spacing.lg,
            paddingBottom: insets.bottom + 96,
          }}
          ListEmptyComponent={
            debounced.length === 0 ? (
              <EmptyState
                title="Cherchez quelqu'un"
                description="Tapez un nom ou pseudo pour inviter dans la room."
              />
            ) : (
              <EmptyState title="Aucun résultat" description="" />
            )
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      <View
        style={[
          styles.cta,
          { paddingBottom: insets.bottom + spacing.md, paddingHorizontal: spacing.xxl },
        ]}
      >
        <Button
          label={
            selected.length === 0 ? 'Sélectionnez des invités' : `Envoyer (${selected.length})`
          }
          variant="primary"
          fullWidth
          size="lg"
          disabled={selected.length === 0 || invite.isPending}
          loading={invite.isPending}
          onPress={handleSend}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  displayName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  username: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxOff: { borderColor: 'rgba(255,255,255,0.2)' },
  selectedCount: { color: colors.primary, fontSize: 12 },
  cta: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: spacing.md,
    backgroundColor: 'rgba(7,11,40,0.95)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  candidateInfo: { flex: 1 },
});
