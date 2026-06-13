import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useRoute, useNavigation, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../../../shared/components/Avatar';
import { Button } from '../../../../shared/components/Button';
import { Input } from '../../../../shared/components/Input';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { Loader } from '../../../../shared/components/Loader';
import { colors, radii, spacing, withAlpha } from '../../../../shared/constants/theme';
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
  const { t } = useTranslation();
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
          Alert.alert(
            t('rooms.invite.successTitle', 'Invitations envoyées'),
            t('rooms.invite.successBody', '{{count}} personne(s) notifiée(s).', {
              count: r.invitedCount,
            }),
          );
          navigation.goBack();
        },
        onError: e =>
          Alert.alert(
            t('rooms.invite.errorTitle', 'Erreur'),
            errorMessage(e, t('rooms.invite.errorBody', 'Échec')),
          ),
      },
    );
  }, [invite, navigation, roomId, selected, t]);

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
          <Text className="text-2xl font-display text-ink">
            {t('rooms.invite.title', 'Inviter')}
          </Text>
          <Pressable
            onPress={navigation.goBack}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('rooms.invite.closeA11y', 'Fermer')}
          >
            <MaterialIcons name="close" size={22} color={colors.text} />
          </Pressable>
        </View>
        <Input
          placeholder={t('rooms.invite.searchPlaceholder', 'Rechercher des utilisateurs')}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          leftAdornment={<MaterialIcons name="search" size={18} color={colors.textMuted} />}
        />
        {selected.length > 0 ? (
          <Text style={styles.selectedCount}>
            {t('rooms.invite.selectedCount', '{{count}} sélectionné(s) · max {{max}}', {
              count: selected.length,
              max: MAX_INVITEES,
            })}
          </Text>
        ) : null}
      </View>

      {searching && results.length === 0 ? (
        <Loader fullscreen accessibilityLabel={t('rooms.invite.searchingA11y', 'Recherche…')} />
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
                title={t('rooms.invite.emptyTitle', "Cherchez quelqu'un")}
                description={t(
                  'rooms.invite.emptyBody',
                  'Tapez un nom ou pseudo pour inviter dans la room.',
                )}
              />
            ) : (
              <EmptyState
                title={t('rooms.invite.noResultsTitle', 'Aucun résultat')}
                description=""
              />
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
            selected.length === 0
              ? t('rooms.invite.btnIdle', 'Sélectionnez des invités')
              : t('rooms.invite.btnActive', 'Envoyer ({{count}})', { count: selected.length })
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
    borderRadius: radii.md,
    backgroundColor: colors.overlayWhite4,
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
  checkboxOff: { borderColor: colors.overlayWhite20 },
  selectedCount: { color: colors.primary, fontSize: 12 },
  cta: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: spacing.md,
    backgroundColor: withAlpha(colors.background, 0.95),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSoft,
  },
  candidateInfo: { flex: 1 },
});
