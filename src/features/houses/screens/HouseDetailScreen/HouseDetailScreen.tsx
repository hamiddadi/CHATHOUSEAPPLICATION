import React, { useCallback } from 'react';
import { Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../../../shared/components/Avatar';
import { Button } from '../../../../shared/components/Button';
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import { useHouse } from '../../hooks/useHouses';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'HouseDetail'>;
type Route = RouteProp<RoomStackParamList, 'HouseDetail'>;

export const HouseDetailScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { data: house, isLoading, isError } = useHouse(route.params.houseId);

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);
  const handleInvite = useCallback(
    () => navigation.navigate('InviteMember', { houseId: route.params.houseId }),
    [navigation, route.params.houseId],
  );

  const handleOptions = useCallback(() => {
    const shareUrl = `https://app.chathouse.com/h/${route.params.houseId}`;
    Alert.alert('Options de la house', undefined, [
      {
        text: 'Partager la house',
        onPress: () => {
          void Share.share({
            title: 'Chathouse',
            message: `Découvre cette house sur Chathouse — ${shareUrl}`,
            url: shareUrl,
          }).catch(() => undefined);
        },
      },
      {
        text: 'Inviter des membres',
        onPress: handleInvite,
      },
      { text: 'Annuler', style: 'cancel' },
    ]);
  }, [handleInvite, route.params.houseId]);

  if (isLoading) return <Loader fullscreen accessibilityLabel="Loading house" />;
  if (isError || !house) {
    return <EmptyState title="House unavailable" description="This house may have been deleted." />;
  }

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-xxl py-lg">
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Pressable
          onPress={handleOptions}
          accessibilityRole="button"
          accessibilityLabel="House options"
          hitSlop={8}
        >
          <MaterialIcons name="more-vert" size={24} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: spacing.xxl,
          paddingBottom: insets.bottom + spacing.giant,
          gap: spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View className="items-center gap-md">
          <Avatar
            uri={house.iconUrl ?? undefined}
            name={house.name}
            sizeValue={96}
            shape="squircle"
          />
          <Text className="text-display font-display text-ink tracking-tight">{house.name}</Text>
          <Text className="text-sm font-body text-ink-muted text-center">{house.description}</Text>
          <View className="flex-row items-center gap-xxl">
            <View className="items-center">
              <Text className="text-xl font-display text-ink">
                {house.membersCount.toLocaleString()}
              </Text>
              <Text className="text-xs font-body text-ink-muted">members</Text>
            </View>
            <View className="items-center">
              <Text className="text-xl font-display text-ink">{house.liveRoomsCount}</Text>
              <Text className="text-xs font-body text-ink-muted">rooms live</Text>
            </View>
          </View>
          <Button
            label="Invite members"
            variant="primaryContainer"
            size="md"
            onPress={handleInvite}
          />
        </View>

        <View className="gap-md mt-lg">
          <Text className="text-xxs font-body-bold text-ink-muted tracking-widest uppercase">
            Members
          </Text>
          {house.members.map(m => (
            <View
              key={m.id}
              className="flex-row items-center gap-md p-md rounded-md bg-overlay-white-5"
            >
              <Avatar uri={m.avatarUrl ?? undefined} name={m.displayName} size="md" />
              <View className="flex-1">
                <Text className="text-md font-body-bold text-ink">{m.displayName}</Text>
                <Text className="text-xs font-body text-ink-muted capitalize">{m.role}</Text>
              </View>
              {m.role !== 'member' && (
                <View className="bg-accent-container px-sm py-xxs rounded-xs">
                  <Text className="text-xxs font-body-bold text-accent uppercase">{m.role}</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
};
