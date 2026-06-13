import React, { memo, useCallback, useState } from 'react';
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
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '../../../../shared/components/Button';
import { Input } from '../../../../shared/components/Input';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import { errorMessage } from '../../../../shared/utils/errorMessage';
import { mediaService } from '../../../../shared/services/api/mediaService';
import { useCreateHouse } from '../../hooks/useHouses';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'CreateHouse'>;
type Privacy = 'open' | 'private';

interface PrivacyOption {
  id: Privacy;
  icon: 'public' | 'lock';
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
    id: 'private',
    icon: 'lock',
    label: t('houses.create.privacyPrivate', 'Private'),
    description: t('houses.create.privacyPrivateDesc', 'Invitation only'),
  },
];

const NAME_MAX = 30;
const DESC_MAX = 200;
const ICON_UPLOAD_SIZE = 96;

interface PrivacyRowProps {
  option: PrivacyOption;
  selected: boolean;
  onPress: (id: Privacy) => void;
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
              ? 'text-xs font-body text-primary-on-container opacity-80'
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

export const CreateHouseScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [privacy, setPrivacy] = useState<Privacy>('open');
  const [iconUri, setIconUri] = useState<string | null>(null);
  const [iconBase64, setIconBase64] = useState<string | null>(null);
  const [iconMime, setIconMime] = useState<string | undefined>(undefined);
  const [uploading, setUploading] = useState(false);

  const createHouse = useCreateHouse();

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

  const handleCreate = useCallback(async () => {
    try {
      // A freshly-picked icon is a local file:// URI — upload it first and send
      // the REMOTE https URL. Sending file:// persisted an unusable path that
      // never loaded for other members.
      let iconUrl: string | undefined;
      if (iconBase64) {
        setUploading(true);
        iconUrl = await mediaService.uploadAvatar(iconBase64, iconMime);
      }
      await createHouse.mutateAsync({
        name,
        description,
        privacy,
        iconUrl,
      });
      navigation.goBack();
    } catch (e) {
      Alert.alert(
        t('houses.create.errorTitle', 'Erreur'),
        errorMessage(e, t('houses.create.errorBody', 'Échec de la création')),
      );
    } finally {
      setUploading(false);
    }
  }, [createHouse, description, iconBase64, iconMime, name, navigation, privacy, t]);

  const canCreate = name.trim().length >= 2 && !createHouse.isPending && !uploading;

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
          accessibilityLabel={t('houses.create.closeA11y', 'Close without creating')}
          hitSlop={8}
        >
          <MaterialIcons name="close" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-lg font-headline text-ink">
          {t('houses.create.title', 'Create a House')}
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

        <View className="gap-sm">
          <Text className="text-xs font-body-medium text-ink-muted ml-xs">
            {t('houses.create.privacyLabel', 'Privacy')}
          </Text>
          <View className="gap-sm">
            {getPrivacyOptions(t).map(o => (
              <PrivacyRow key={o.id} option={o} selected={privacy === o.id} onPress={setPrivacy} />
            ))}
          </View>
        </View>

        <Button
          label={t('houses.create.submitBtn', 'Create House')}
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canCreate}
          loading={createHouse.isPending || uploading}
          onPress={handleCreate}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};
