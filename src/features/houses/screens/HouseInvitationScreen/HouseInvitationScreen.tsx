import React, { useCallback } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../../../shared/components/Avatar';
import { Button } from '../../../../shared/components/Button';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { Loader } from '../../../../shared/components/Loader';
import { resolveHouseIcon } from '../../../../shared/constants/images';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import { errorMessage } from '../../../../shared/utils/errorMessage';
import { useAcceptInvitation, useHouse } from '../../hooks/useHouses';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'HouseInvitation'>;
type Route = RouteProp<RoomStackParamList, 'HouseInvitation'>;

const HOUSE_ICON_SIZE = 120;

export const HouseInvitationScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();

  const { houseId, inviteToken } = route.params;

  const { data: house, isLoading, isError } = useHouse(houseId, inviteToken);
  const accept = useAcceptInvitation();

  const houseName = house?.name ?? t('houses.invitation.defaultName', 'this house');
  const memberCountLabel =
    house !== undefined
      ? t('houses.invitation.membersCount', '{{countStr}} members', {
          countStr: house.membersCount.toLocaleString(),
        })
      : '';

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);
  const handleAccept = useCallback(async () => {
    if (accept.isPending) return;
    try {
      // Send the signed invite token so the backend can verify it (signature +
      // expiry) and grant entry into a PRIVATE house without a per-user
      // notification. Differentiated failures (expired / invalid) surface via
      // the backend error code (CLUB_008 / CLUB_009) resolved by errorMessage.
      const result = await accept.mutateAsync({ houseId, inviteToken });
      // Idempotent success: the user was already a member. Reassure them rather
      // than implying a fresh join, then land on the house.
      if (result.alreadyMember) {
        Alert.alert(
          t('houses.invitation.alreadyMemberTitle', 'Déjà membre'),
          t('houses.invitation.alreadyMemberBody', 'Vous faites déjà partie de cette house.'),
        );
      }
      navigation.replace('HouseDetail', { houseId });
    } catch (e) {
      Alert.alert(
        t('houses.invitation.errorTitle', 'Erreur'),
        errorMessage(e, t('houses.invitation.errorBody', "Impossible d'accepter l'invitation.")),
      );
    }
  }, [accept, houseId, inviteToken, navigation, t]);
  const handleDecline = useCallback(() => navigation.goBack(), [navigation]);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-xxl py-lg">
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('houses.invitation.backA11y', 'Back')}
          hitSlop={8}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-lg font-headline text-ink ml-md">
          {t('houses.invitation.title', 'Invitation')}
        </Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <Loader accessibilityLabel={t('houses.invitation.loading', 'Loading invitation')} />
        </View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center px-xxl">
          <EmptyState
            title={t('houses.invitation.errorLoadTitle', 'Invitation unavailable')}
            description={t(
              'houses.invitation.errorLoadBody',
              'This house may no longer exist or the invite has expired.',
            )}
          />
        </View>
      ) : (
        <View
          className="flex-1 items-center justify-center px-xxl"
          style={{ paddingBottom: insets.bottom + spacing.giant }}
        >
          <View className="items-center gap-lg">
            <Avatar
              uri={house?.iconUrl ?? resolveHouseIcon(houseId)}
              name={houseName}
              sizeValue={HOUSE_ICON_SIZE}
              shape="squircle"
            />
            <Text className="text-display font-display text-ink tracking-tight text-center">
              {houseName}
            </Text>
            {memberCountLabel !== '' && (
              <Text className="text-sm font-body text-ink-muted text-center">
                {memberCountLabel}
              </Text>
            )}

            {/* The inviter isn't carried by the invite token/house payload, so we
              keep the copy house-centric rather than showing a fabricated name.
              The opaque token is never rendered — it's a bearer credential. */}
            <Text className="text-md font-body text-ink-muted text-center mt-lg">
              {t('houses.invitation.subtitle', "You've been invited to join this house.")}
            </Text>
          </View>

          <View className="w-full gap-sm mt-giant">
            <Button
              label={t('houses.invitation.acceptBtn', 'Accept invitation')}
              variant="primary"
              size="lg"
              fullWidth
              loading={accept.isPending}
              disabled={accept.isPending}
              onPress={handleAccept}
            />
            <Button
              label={t('houses.invitation.declineBtn', 'Decline')}
              variant="ghost"
              size="md"
              fullWidth
              onPress={handleDecline}
            />
          </View>
        </View>
      )}
    </View>
  );
};
