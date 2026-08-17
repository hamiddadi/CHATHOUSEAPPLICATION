import React, { memo, useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { launchImageLibrary } from 'react-native-image-picker';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '../../../../shared/components/Button';
import { Input } from '../../../../shared/components/Input';
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import { errorMessage } from '../../../../shared/utils/errorMessage';
import { mediaService } from '../../../../shared/services/api/mediaService';
import type { HousePrivacy } from '../../../../shared/types/domain';
import { useAuthStore } from '../../../auth/store/authStore';
import { useDeleteHouse, useHouse, useUpdateHouse } from '../../hooks/useHouses';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'ManageHouse'>;
type Route = RouteProp<RoomStackParamList, 'ManageHouse'>;

interface PrivacyOption {
  id: HousePrivacy;
  icon: 'public' | 'lock' | 'groups';
  label: string;
  description: string;
}

const getPrivacyOptions = (t: TFunction): PrivacyOption[] => [
  {
    id: 'open',
    icon: 'public',
    label: t('houses.create.privacyOpen', 'Open'),
    description: t('houses.create.privacyOpenDesc', 'Anyone can join and start rooms'),
  },
  {
    id: 'social',
    icon: 'groups',
    label: t('houses.create.privacySocial', 'Social'),
    description: t('houses.create.privacySocialDesc', 'Anyone can request to join; admins approve'),
  },
  {
    id: 'private',
    icon: 'lock',
    label: t('houses.create.privacyPrivate', 'Private'),
    description: t('houses.create.privacyPrivateDesc', 'Invitation only'),
  },
];

// Aligned with the backend zod schema (clubs.schema.ts): name max 50,
// description max 500.
const NAME_MAX = 50;
const DESC_MAX = 500;
const ICON_UPLOAD_SIZE = 96;

interface PrivacyRowProps {
  option: PrivacyOption;
  selected: boolean;
  onPress: (id: HousePrivacy) => void;
}

const PrivacyRow: React.FC<PrivacyRowProps> = memo(({ option, selected, onPress }) => {
  const handle = useCallback(() => onPress(option.id), [option.id, onPress]);
  return (
    <Pressable
      onPress={handle}
      accessibilityRole="radio"
      accessibilityLabel={`${option.label}: ${option.description}`}
      accessibilityState={{ selected }}
      className={
        selected
          ? 'flex-row items-center gap-md p-lg rounded-md bg-primary-container'
          : 'flex-row items-center gap-md p-lg rounded-md bg-overlay-white-5 border border-overlay-white-10'
      }
    >
      <MaterialIcons
        name={option.icon}
        size={24}
        color={selected ? colors.onPrimaryContainer : colors.text}
      />
      <View className="flex-1">
        <Text
          className={
            selected
              ? 'text-md font-body-bold text-primary-on-container'
              : 'text-md font-body-bold text-ink'
          }
        >
          {option.label}
        </Text>
        <Text
          className={
            selected
              ? 'text-xs font-body text-primary-on-container'
              : 'text-xs font-body text-ink-muted'
          }
        >
          {option.description}
        </Text>
      </View>
      {selected && <MaterialIcons name="check" size={20} color={colors.onPrimaryContainer} />}
    </Pressable>
  );
});
PrivacyRow.displayName = 'PrivacyRow';

export const ManageHouseScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const houseId = route.params.houseId;
  const { data: house, isLoading, isError } = useHouse(houseId);
  const viewerId = useAuthStore(s => s.user?.id ?? null);

  const updateHouse = useUpdateHouse();
  const deleteHouse = useDeleteHouse();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rules, setRules] = useState('');
  const [privacy, setPrivacy] = useState<HousePrivacy>('open');
  const [iconUri, setIconUri] = useState<string | null>(null);
  const [iconBase64, setIconBase64] = useState<string | null>(null);
  const [iconMime, setIconMime] = useState<string | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [initialised, setInitialised] = useState(false);

  // Pre-fill the form from the loaded house exactly once, so subsequent
  // background refetches (e.g. after a save) don't clobber in-flight edits.
  if (house && !initialised) {
    setName(house.name);
    setDescription(house.description);
    setRules(house.rules ?? '');
    setPrivacy(house.privacy);
    setIconUri(house.iconUrl);
    setInitialised(true);
  }

  // Delete is owner-only server-side (CLUB_005); only surface it to the owner.
  const isOwner = !!viewerId && house?.ownerId === viewerId;
  // Backend update() rejects anyone who isn't an ADMIN member (CLUB_002); the
  // owner is always materialised as an ADMIN member server-side, but keep the
  // ownerId check as a belt-and-braces fallback. Guarding locally avoids a
  // fully editable form that can only end in a generic server rejection.
  const isAdminMember =
    !!viewerId && (house?.members.some(m => m.id === viewerId && m.role === 'admin') ?? false);
  const canManage = isOwner || isAdminMember;

  const handleClose = useCallback(() => navigation.goBack(), [navigation]);

  const handlePickIcon = useCallback(async () => {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      includeBase64: true,
      quality: 0.8,
      maxWidth: 1024,
      maxHeight: 1024,
      selectionLimit: 1,
    });
    if (result.didCancel) return;
    const asset = result.assets?.[0];
    if (asset?.uri) {
      setIconUri(asset.uri);
      setIconBase64(asset.base64 ?? null);
      setIconMime(asset.type);
    }
  }, []);

  const handleSave = useCallback(async () => {
    try {
      // A freshly-picked icon is a local file:// URI — upload it first and
      // send the REMOTE https URL (same flow as CreateHouse). When the icon
      // wasn't re-picked, iconUrl stays undefined and update() leaves it as-is.
      let iconUrl: string | undefined;
      if (iconBase64) {
        setUploading(true);
        iconUrl = await mediaService.uploadAvatar(iconBase64, iconMime);
      }
      await updateHouse.mutateAsync({
        houseId,
        input: { name, description, rules: rules.trim() || null, privacy, iconUrl },
      });
      navigation.goBack();
    } catch (e) {
      Alert.alert(
        t('houses.manage.errorTitle', 'Error'),
        errorMessage(e, t('houses.manage.saveError', "Couldn't save the changes.")),
      );
    } finally {
      setUploading(false);
    }
  }, [
    updateHouse,
    houseId,
    name,
    description,
    rules,
    privacy,
    iconBase64,
    iconMime,
    navigation,
    t,
  ]);

  const performDelete = useCallback(() => {
    deleteHouse.mutate(houseId, {
      onSuccess: () => navigation.navigate('HouseList'),
      onError: e =>
        Alert.alert(
          t('houses.manage.errorTitle', 'Error'),
          errorMessage(e, t('houses.manage.deleteError', "Couldn't delete this house.")),
        ),
    });
  }, [deleteHouse, houseId, navigation, t]);

  const handleDelete = useCallback(() => {
    Alert.alert(
      t('houses.manage.deleteConfirmTitle', 'Delete house?'),
      t('houses.manage.deleteConfirmBody', 'This permanently removes the house for all members.'),
      [
        { text: t('houses.manage.cancel', 'Cancel'), style: 'cancel' },
        {
          text: t('houses.manage.deleteConfirm', 'Delete'),
          style: 'destructive',
          onPress: performDelete,
        },
      ],
    );
  }, [performDelete, t]);

  const privacyOptions = useMemo(() => getPrivacyOptions(t), [t]);
  const canSave =
    name.trim().length >= 2 && !updateHouse.isPending && !deleteHouse.isPending && !uploading;

  if (isLoading) {
    return <Loader fullscreen accessibilityLabel={t('houses.manage.loading', 'Loading house')} />;
  }
  if (isError || !house) {
    // This screen is a modal: without an explicit way out, a load failure was
    // a dead-end. Offer a Back action alongside the message.
    return (
      <EmptyState
        title={t('houses.manage.unavailableTitle', 'House unavailable')}
        description={t('houses.manage.unavailableBody', 'This house may have been deleted.')}
        actionLabel={t('common.back', 'Back')}
        onAction={handleClose}
      />
    );
  }
  if (!canManage) {
    // Local mirror of the backend CLUB_002 gate (update is ADMIN/owner-only):
    // without it a non-admin gets a fully editable form whose save can only
    // end in a generic server rejection.
    return (
      <EmptyState
        title={t('houses.manage.notAllowedTitle', 'Admins only')}
        description={t(
          'houses.manage.notAllowedBody',
          'Only the owner or an admin can manage this house.',
        )}
        actionLabel={t('common.back', 'Back')}
        onAction={handleClose}
      />
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top }}
    >
      <View className="flex-row items-center justify-between px-xxl py-lg">
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel={t('houses.manage.closeA11y', 'Close without saving')}
          hitSlop={8}
        >
          <MaterialIcons name="close" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-lg font-headline text-ink">
          {t('houses.manage.title', 'Manage House')}
        </Text>
        <View className="w-[24px]" />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: spacing.xxl,
          paddingBottom: insets.bottom + spacing.giant,
          gap: spacing.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="items-center py-lg">
          <Pressable
            onPress={handlePickIcon}
            accessibilityRole="button"
            accessibilityLabel={
              iconUri
                ? t('houses.create.replaceIconA11y', 'Replace house icon')
                : t('houses.create.uploadIconA11y', 'Upload house icon')
            }
            className="items-center justify-center bg-overlay-white-10 border-2 border-dashed border-overlay-white-30 rounded-xxl overflow-hidden"
            style={{ width: ICON_UPLOAD_SIZE, height: ICON_UPLOAD_SIZE }}
          >
            {iconUri ? (
              <Image
                source={{ uri: iconUri }}
                style={{ width: ICON_UPLOAD_SIZE, height: ICON_UPLOAD_SIZE }}
                resizeMode="cover"
              />
            ) : (
              <MaterialIcons name="add-a-photo" size={28} color={colors.text} />
            )}
          </Pressable>
          <Text className="text-xs font-body text-ink-muted mt-sm">
            {iconUri
              ? t('houses.create.replaceIcon', 'Tap to replace')
              : t('houses.create.uploadIcon', 'House icon (optional)')}
          </Text>
        </View>

        <Input
          label={t('houses.create.nameLabel', 'House name')}
          placeholder={t('houses.create.namePlaceholder', 'e.g. Indie Hackers')}
          value={name}
          onChangeText={setName}
          maxLength={NAME_MAX}
          helperText={`${name.length} / ${NAME_MAX}`}
        />

        <Input
          label={t('houses.create.descLabel', 'Description')}
          placeholder={t('houses.create.descPlaceholder', 'What is this house about?')}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
          maxLength={DESC_MAX}
          helperText={`${description.length} / ${DESC_MAX}`}
        />

        <Input
          label={t('houses.create.rulesLabel', 'Rules (optional)')}
          placeholder={t('houses.create.rulesPlaceholder', 'The house rules…')}
          value={rules}
          onChangeText={setRules}
          multiline
          numberOfLines={4}
          maxLength={2000}
        />

        <View className="gap-sm">
          <Text className="text-xs font-body-medium text-ink-muted ml-xs">
            {t('houses.create.privacyLabel', 'Privacy')}
          </Text>
          <View className="gap-sm">
            {privacyOptions.map(o => (
              <PrivacyRow key={o.id} option={o} selected={privacy === o.id} onPress={setPrivacy} />
            ))}
          </View>
        </View>

        <Button
          label={t('houses.manage.save', 'Save changes')}
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canSave}
          loading={updateHouse.isPending || uploading}
          onPress={handleSave}
        />

        {isOwner && (
          <View className="gap-sm mt-xl">
            <Text className="text-xxs font-body-bold text-ink-muted tracking-widest uppercase">
              {t('houses.manage.dangerZone', 'Danger zone')}
            </Text>
            <Button
              label={t('houses.manage.delete', 'Delete house')}
              variant="danger"
              size="lg"
              fullWidth
              disabled={deleteHouse.isPending || updateHouse.isPending}
              loading={deleteHouse.isPending}
              onPress={handleDelete}
            />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};
