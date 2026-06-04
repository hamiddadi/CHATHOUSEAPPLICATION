import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../../../shared/components/Avatar';
import { Input } from '../../../../shared/components/Input';
import { Loader } from '../../../../shared/components/Loader';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { MessageStackParamList } from '../../../../core/navigation/types';
import { useAuthStore } from '../../../auth/store/authStore';
import {
  useGroup,
  useLeaveGroup,
  useRemoveGroupMember,
  useRenameGroup,
} from '../../hooks/useGroups';

type Nav = NativeStackNavigationProp<MessageStackParamList, 'GroupInfo'>;
type Route = RouteProp<MessageStackParamList, 'GroupInfo'>;

const TITLE_MAX = 80;

export const GroupInfoScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const conversationId = route.params.conversationId;
  const myId = useAuthStore(s => s.user?.id ?? null);

  const { data: group, isLoading } = useGroup(conversationId);
  const rename = useRenameGroup();
  const removeMember = useRemoveGroupMember();
  const leave = useLeaveGroup();

  const isOwner = !!group && group.ownerId === myId;

  // Seed the editable title from the server value once it loads.
  const [title, setTitle] = useState('');
  useEffect(() => {
    if (group) setTitle(group.title ?? '');
  }, [group]);

  const titleChanged = useMemo(
    () => group != null && title.trim().length > 0 && title.trim() !== (group.title ?? ''),
    [group, title],
  );

  const handleSaveTitle = useCallback(() => {
    if (!titleChanged) return;
    rename.mutate({ conversationId, title: title.trim() });
  }, [conversationId, rename, title, titleChanged]);

  const handleRemove = useCallback(
    (userId: string, name: string) => {
      Alert.alert(
        t('messages.removeMemberTitle', 'Remove member'),
        t('messages.removeMemberBody', { name, defaultValue: `Remove ${name} from the group?` }),
        [
          { text: t('common.cancel', 'Cancel'), style: 'cancel' },
          {
            text: t('messages.remove', 'Remove'),
            style: 'destructive',
            onPress: () => removeMember.mutate({ conversationId, userId }),
          },
        ],
      );
    },
    [conversationId, removeMember, t],
  );

  const handleLeave = useCallback(() => {
    Alert.alert(
      t('messages.leaveGroupTitle', 'Leave group'),
      t('messages.leaveGroupBody', 'You will stop receiving messages from this group.'),
      [
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
        {
          text: t('messages.leave', 'Leave'),
          style: 'destructive',
          onPress: () =>
            leave.mutate(conversationId, {
              // Back to the conversation list — the group is gone from our side.
              onSettled: () => navigation.popToTop(),
            }),
        },
      ],
    );
  }, [conversationId, leave, navigation, t]);

  const handleAddPeople = useCallback(
    () => navigation.navigate('AddGroupMembers', { conversationId }),
    [conversationId, navigation],
  );

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

  if (isLoading || !group) {
    return <Loader fullscreen accessibilityLabel={t('common.loading')} />;
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top }}
    >
      <View className="flex-row items-center gap-md px-xxl py-md">
        <Pressable onPress={handleBack} accessibilityRole="button" hitSlop={8}>
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-xl font-display text-ink tracking-tight">
          {t('messages.groupInfo', 'Group info')}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.xxl,
          paddingBottom: insets.bottom + spacing.giant,
          gap: spacing.xl,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="items-center gap-sm pt-md">
          <View className="w-20 h-20 rounded-full bg-primary/15 items-center justify-center">
            <MaterialIcons name="groups" size={40} color={colors.primary} />
          </View>
        </View>

        <View className="flex-row items-end gap-sm">
          <View className="flex-1">
            <Input
              label={t('messages.groupNameLabel', 'Group name')}
              placeholder={t('messages.groupNamePlaceholder', 'Name this group')}
              value={title}
              onChangeText={setTitle}
              maxLength={TITLE_MAX}
            />
          </View>
          <Pressable
            onPress={handleSaveTitle}
            disabled={!titleChanged || rename.isPending}
            accessibilityRole="button"
            accessibilityLabel={t('common.save', 'Save')}
            className={
              titleChanged && !rename.isPending
                ? 'w-12 h-12 rounded-pill bg-primary items-center justify-center mb-xxs'
                : 'w-12 h-12 rounded-pill bg-overlay-white-10 items-center justify-center mb-xxs opacity-50'
            }
          >
            <MaterialIcons name="check" size={20} color={colors.onPrimary} />
          </Pressable>
        </View>

        <View className="gap-sm">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-body-bold uppercase tracking-widest text-ink-muted">
              {t('messages.memberCount', {
                count: group.members.length,
                defaultValue: `${group.members.length} members`,
              })}
            </Text>
            <Pressable
              onPress={handleAddPeople}
              accessibilityRole="button"
              className="flex-row items-center gap-xs"
            >
              <MaterialIcons name="person-add" size={18} color={colors.primary} />
              <Text className="text-sm font-body-bold text-primary">
                {t('messages.addPeople', 'Add people')}
              </Text>
            </Pressable>
          </View>

          {group.members.map(m => {
            const name = m.displayName || m.username;
            const isMe = m.id === myId;
            return (
              <View key={m.id} className="flex-row items-center gap-md py-sm">
                <Avatar uri={m.avatarUrl ?? undefined} name={m.displayName} size="md" />
                <View className="flex-1">
                  <Text className="text-md font-body-bold text-ink" numberOfLines={1}>
                    {name}
                    {isMe ? ` ${t('messages.you', '(you)')}` : ''}
                    {m.id === group.ownerId ? ` · ${t('messages.owner', 'owner')}` : ''}
                  </Text>
                  <Text className="text-xs font-body text-ink-muted">@{m.username}</Text>
                </View>
                {isOwner && !isMe ? (
                  <Pressable
                    onPress={() => handleRemove(m.id, name)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${name}`}
                    hitSlop={8}
                  >
                    <MaterialIcons name="remove-circle-outline" size={22} color={colors.danger} />
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>

        <Pressable
          onPress={handleLeave}
          accessibilityRole="button"
          className="flex-row items-center justify-center gap-sm py-md rounded-md bg-danger/10 border border-danger/30 mt-md"
        >
          <MaterialIcons name="logout" size={20} color={colors.danger} />
          <Text className="text-md font-body-bold text-danger">
            {t('messages.leaveGroup', 'Leave group')}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};
