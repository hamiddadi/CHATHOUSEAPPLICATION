import React, { memo, useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import Clipboard from '@react-native-clipboard/clipboard';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Avatar } from '../../../../shared/components/Avatar';
import { Button } from '../../../../shared/components/Button';
import { Input } from '../../../../shared/components/Input';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { Loader } from '../../../../shared/components/Loader';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import type { User } from '../../../../shared/types/domain';
import { useDebouncedValue } from '../../../../shared/hooks/useDebouncedValue';
import { useSearchUsers } from '../../../profile/hooks/useProfile';
import { useHouseInviteLink, useInviteToHouse } from '../../hooks/useHouses';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'InviteMember'>;
type Route = RouteProp<RoomStackParamList, 'InviteMember'>;

// The copied/shared URL comes from the server (it carries a signed token
// aligned with the `house/:houseId/invite/:token` deep link route) so the
// displayed and copied links can never drift apart.
//
// Per-user invite outcome: 'sent' (a fresh invitation was dispatched) vs
// 'member' (backend reported sent:0 → the user is already a member, so we must
// NOT claim a new invite was sent).
type InviteState = 'sent' | 'member';

// Match the debounce convention used by the other user-search screens
// (InviteToRoomScreen / ExploreScreen) so each keystroke doesn't fire a request.
const SEARCH_DEBOUNCE_MS = 250;

interface UserRowProps {
  user: User;
  state: InviteState | undefined;
  onInvite: (id: string) => void;
  t: TFunction;
}

const UserRow: React.FC<UserRowProps> = memo(({ user, state, onInvite, t }) => {
  const handle = useCallback(() => onInvite(user.id), [onInvite, user.id]);
  return (
    <View className="flex-row items-center gap-md p-md rounded-md bg-overlay-white-5">
      <Avatar uri={user.avatarUrl ?? undefined} name={user.displayName} size="md" />
      <View className="flex-1">
        <Text className="text-md font-body-bold text-ink">{user.displayName}</Text>
        <Text className="text-xs font-body text-ink-muted">@{user.username}</Text>
      </View>
      {state !== undefined ? (
        <Button
          label={
            state === 'member'
              ? t('houses.invite.alreadyMember', 'Member')
              : t('houses.invite.invited', 'Invited')
          }
          variant="primaryContainer"
          size="sm"
          leftIcon={<MaterialIcons name="check" size={16} color={colors.onPrimaryContainer} />}
          onPress={handle}
        />
      ) : (
        <Button
          label={t('houses.invite.inviteBtn', 'Invite')}
          variant="outline"
          size="sm"
          onPress={handle}
        />
      )}
    </View>
  );
});
UserRow.displayName = 'UserRow';

export const InviteMemberScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [invited, setInvited] = useState<Record<string, InviteState>>({});
  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);

  const {
    data: users,
    isLoading,
    isError: isSearchError,
    refetch: refetchSearch,
  } = useSearchUsers(debouncedQuery);
  const inviteToHouse = useInviteToHouse();
  // Signed, shareable invite link (carries a token routable via the
  // `house/:houseId/invite/:token` deep link). Loading and failures are kept
  // distinct so a failed request never looks like a link that is still loading.
  const {
    data: inviteLink,
    isError: isInviteLinkError,
    refetch: refetchInviteLink,
  } = useHouseInviteLink(route.params.houseId);

  const handleClose = useCallback(() => navigation.goBack(), [navigation]);

  const inviteUrl = inviteLink?.url;
  const displayLink = isInviteLinkError
    ? t('common.error', 'Something went wrong')
    : (inviteUrl?.replace(/^https?:\/\//, '') ?? t('houses.invite.linkLoading', '…'));
  const handleCopyLink = useCallback(async () => {
    if (!inviteUrl) return;
    try {
      await Clipboard.setString(inviteUrl);
      Alert.alert(
        t('houses.invite.copiedTitle', 'Copié'),
        t('houses.invite.copiedBody', "Le lien d'invitation est dans votre presse-papier."),
        [
          {
            text: t('houses.invite.share', 'Partager'),
            onPress: () => {
              void Share.share({ message: inviteUrl, url: inviteUrl }).catch(() => undefined);
            },
          },
          { text: t('houses.invite.ok', 'OK'), style: 'cancel' },
        ],
      );
    } catch {
      Alert.alert(
        t('houses.invite.errorTitle', 'Erreur'),
        t('houses.invite.copyError', 'Impossible de copier le lien.'),
      );
    }
  }, [inviteUrl, t]);

  const handleRetryLink = useCallback(() => {
    void refetchInviteLink();
  }, [refetchInviteLink]);

  const handleRetrySearch = useCallback(() => {
    void refetchSearch();
  }, [refetchSearch]);

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
          // Only reflect a real invitation once the backend confirms. sent === 0
          // means the target was already a member (nothing was dispatched), so
          // label the row "Member" rather than falsely claiming "Invited".
          onSuccess: result =>
            setInvited(prev => ({ ...prev, [id]: result.sent > 0 ? 'sent' : 'member' })),
          onError: () =>
            Alert.alert(
              t('houses.invite.errorTitle', 'Erreur'),
              t('houses.invite.inviteError', "L'invitation n'a pas pu être envoyée."),
            ),
        },
      );
    },
    [invited, inviteToHouse, route.params.houseId, t],
  );

  const renderItem = useCallback(
    ({ item }: { item: User }) => (
      <UserRow user={item} state={invited[item.id]} onInvite={handleInvite} t={t} />
    ),
    [handleInvite, invited, t],
  );
  const keyExtractor = useCallback((item: User) => item.id, []);
  const renderSeparator = useCallback(() => <View className="h-sm" />, []);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-xxl py-lg">
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel={t('houses.invite.closeA11y', 'Close invite dialog')}
          hitSlop={8}
        >
          <MaterialIcons name="close" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-lg font-headline text-ink">
          {t('houses.invite.title', 'Invite to House')}
        </Text>
        <View className="w-[24px]" />
      </View>

      <View className="px-xxl gap-md">
        <View className="flex-row items-center gap-sm p-md rounded-md bg-overlay-white-5 border border-overlay-white-10">
          <MaterialIcons name="link" size={18} color={colors.textMuted} />
          <Text className="flex-1 text-xs font-body text-ink-muted" numberOfLines={1}>
            {displayLink}
          </Text>
          <Pressable
            onPress={isInviteLinkError ? handleRetryLink : handleCopyLink}
            disabled={!inviteUrl && !isInviteLinkError}
            accessibilityRole="button"
            accessibilityLabel={
              isInviteLinkError
                ? t('houses.invite.retryLinkA11y', 'Retry invite link')
                : t('houses.invite.copyA11y', 'Copy invite link')
            }
            accessibilityState={{ disabled: !inviteUrl && !isInviteLinkError }}
            hitSlop={12}
          >
            {isInviteLinkError ? (
              <Text className="text-xs font-body-bold text-primary">
                {t('common.retry', 'Retry')}
              </Text>
            ) : (
              <MaterialIcons
                name="content-copy"
                size={18}
                color={inviteUrl ? colors.primary : colors.textMuted}
              />
            )}
          </Pressable>
        </View>

        <Input
          placeholder={t('houses.invite.searchPlaceholder', 'Search users')}
          value={query}
          onChangeText={setQuery}
          accessibilityLabel={t('houses.invite.searchA11y', 'Search users to invite')}
          leftAdornment={<MaterialIcons name="search" size={18} color={colors.textMuted} />}
        />
      </View>

      {isLoading ? (
        <Loader fullscreen accessibilityLabel={t('houses.invite.searching', 'Searching users')} />
      ) : isSearchError ? (
        <EmptyState
          title={t('rooms.invite.searchErrorTitle', 'Search failed')}
          description={t('rooms.invite.searchErrorBody', 'Check your connection and try again.')}
          actionLabel={t('common.retry', 'Retry')}
          onAction={handleRetrySearch}
        />
      ) : (
        <FlatList
          data={users ?? []}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ItemSeparatorComponent={renderSeparator}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + spacing.giant, paddingTop: spacing.lg },
          ]}
          ListEmptyComponent={
            <EmptyState
              title={
                debouncedQuery.length === 0
                  ? t('houses.invite.emptyStateTitle', 'Inviter des membres')
                  : t('houses.invite.noResults', 'Aucun résultat')
              }
              description={
                debouncedQuery.length === 0
                  ? t(
                      'houses.invite.emptyStateBody',
                      'Recherche une personne par nom ou pseudo, ou partage le lien ci-dessus.',
                    )
                  : t('houses.invite.noResultsBody', 'Essaie un autre nom ou pseudo.')
              }
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.xxl },
});
