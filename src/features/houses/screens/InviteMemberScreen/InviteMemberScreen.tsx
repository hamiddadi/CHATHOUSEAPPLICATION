import React, { memo, useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../../../shared/components/Avatar';
import { Button } from '../../../../shared/components/Button';
import { Input } from '../../../../shared/components/Input';
import { Loader } from '../../../../shared/components/Loader';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import type { User } from '../../../../shared/types/domain';
import { useDebouncedValue } from '../../../../shared/hooks/useDebouncedValue';
import { useSearchUsers } from '../../../profile/hooks/useProfile';
import { useInviteToHouse } from '../../hooks/useHouses';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'InviteMember'>;
type Route = RouteProp<RoomStackParamList, 'InviteMember'>;

// Single source of truth for the invite link so the copied/shared URL and the
// on-screen text can never drift apart.
const INVITE_HOST = 'app.chathouse.com';
const INVITE_BASE_URL = `https://${INVITE_HOST}/invite`;

// Match the debounce convention used by the other user-search screens
// (InviteToRoomScreen / ExploreScreen) so each keystroke doesn't fire a request.
const SEARCH_DEBOUNCE_MS = 250;

interface UserRowProps {
  user: User;
  invited: boolean;
  onInvite: (id: string) => void;
}

const UserRow: React.FC<UserRowProps> = memo(({ user, invited, onInvite }) => {
  const handle = useCallback(() => onInvite(user.id), [onInvite, user.id]);
  return (
    <View className="flex-row items-center gap-md p-md rounded-md bg-overlay-white-5">
      <Avatar uri={user.avatarUrl ?? undefined} name={user.displayName} size="md" />
      <View className="flex-1">
        <Text className="text-md font-body-bold text-ink">{user.displayName}</Text>
        <Text className="text-xs font-body text-ink-muted">@{user.username}</Text>
      </View>
      {invited ? (
        <Button
          label="Invited"
          variant="primaryContainer"
          size="sm"
          leftIcon={<MaterialIcons name="check" size={16} color={colors.onPrimaryContainer} />}
          onPress={handle}
        />
      ) : (
        <Button label="Invite" variant="outline" size="sm" onPress={handle} />
      )}
    </View>
  );
});
UserRow.displayName = 'UserRow';

export const InviteMemberScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [invited, setInvited] = useState<Record<string, boolean>>({});
  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);

  const { data: users, isLoading } = useSearchUsers(debouncedQuery);
  const inviteToHouse = useInviteToHouse();

  const handleClose = useCallback(() => navigation.goBack(), [navigation]);

  const inviteUrl = `${INVITE_BASE_URL}/${route.params.houseId}`;
  const handleCopyLink = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(inviteUrl);
      Alert.alert('Copié', "Le lien d'invitation est dans votre presse-papier.", [
        {
          text: 'Partager',
          onPress: () => {
            void Share.share({ message: inviteUrl, url: inviteUrl }).catch(() => undefined);
          },
        },
        { text: 'OK', style: 'cancel' },
      ]);
    } catch {
      Alert.alert('Erreur', 'Impossible de copier le lien.');
    }
  }, [inviteUrl]);

  const handleInvite = useCallback(
    (id: string) => {
      // Invitation is a one-way, additive action — there is no un-invite endpoint.
      // Once invited, a second tap must NOT silently flip the UI back to "Invite"
      // (which would falsely suggest the invitation was cancelled). Also guard
      // against double-submission while a request is in flight.
      if (invited[id] || inviteToHouse.isPending) return;
      inviteToHouse.mutate(
        { houseId: route.params.houseId, userIds: [id] },
        {
          // Only mark as invited once the backend confirms — so a failed request
          // doesn't leave a false-positive "Invited" badge.
          onSuccess: () => setInvited(prev => ({ ...prev, [id]: true })),
          onError: () => Alert.alert('Erreur', "L'invitation n'a pas pu être envoyée."),
        },
      );
    },
    [invited, inviteToHouse, route.params.houseId],
  );

  const renderItem = useCallback(
    ({ item }: { item: User }) => (
      <UserRow user={item} invited={!!invited[item.id]} onInvite={handleInvite} />
    ),
    [handleInvite, invited],
  );
  const keyExtractor = useCallback((item: User) => item.id, []);
  const renderSeparator = useCallback(() => <View className="h-sm" />, []);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-xxl py-lg">
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close invite dialog"
          hitSlop={8}
        >
          <MaterialIcons name="close" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-lg font-headline text-ink">Invite to House</Text>
        <View className="w-[24px]" />
      </View>

      <View className="px-xxl gap-md">
        <View className="flex-row items-center gap-sm p-md rounded-md bg-overlay-white-5 border border-overlay-white-10">
          <MaterialIcons name="link" size={18} color={colors.textMuted} />
          <Text className="flex-1 text-xs font-body text-ink-muted" numberOfLines={1}>
            {`${INVITE_HOST}/invite/${route.params.houseId}`}
          </Text>
          <Pressable
            onPress={handleCopyLink}
            accessibilityRole="button"
            accessibilityLabel="Copy invite link"
            hitSlop={6}
          >
            <MaterialIcons name="content-copy" size={18} color={colors.primary} />
          </Pressable>
        </View>

        <Input
          placeholder="Search users"
          value={query}
          onChangeText={setQuery}
          leftAdornment={<MaterialIcons name="search" size={18} color={colors.textMuted} />}
        />
      </View>

      {isLoading ? (
        <Loader fullscreen accessibilityLabel="Searching users" />
      ) : (
        <FlatList
          data={users ?? []}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ItemSeparatorComponent={renderSeparator}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + spacing.giant, paddingTop: spacing.lg },
          ]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.xxl },
});
