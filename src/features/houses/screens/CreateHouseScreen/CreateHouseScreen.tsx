import React, { memo, useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../../../shared/components/Button';
import { Input } from '../../../../shared/components/Input';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import { useCreateHouse } from '../../hooks/useHouses';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'CreateHouse'>;
type Privacy = 'open' | 'private';

interface PrivacyOption {
  id: Privacy;
  icon: 'public' | 'lock';
  label: string;
  description: string;
}

const PRIVACY_OPTIONS: readonly PrivacyOption[] = [
  { id: 'open', icon: 'public', label: 'Open', description: 'Anyone can join and start rooms' },
  { id: 'private', icon: 'lock', label: 'Private', description: 'Invitation only' },
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
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [privacy, setPrivacy] = useState<Privacy>('open');

  const createHouse = useCreateHouse();

  const handleClose = useCallback(() => navigation.goBack(), [navigation]);
  const handleCreate = useCallback(async () => {
    try {
      await createHouse.mutateAsync({
        name,
        description,
        privacy,
      });
      navigation.goBack();
    } catch {
      // Surface via toast later.
    }
  }, [createHouse, description, name, navigation, privacy]);

  const canCreate = name.trim().length >= 2 && !createHouse.isPending;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-xxl py-lg">
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close without creating"
          hitSlop={8}
        >
          <MaterialIcons name="close" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-lg font-headline text-ink">Create a House</Text>
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
            accessibilityRole="button"
            accessibilityLabel="Upload house icon"
            className="items-center justify-center bg-overlay-white-10 border-2 border-dashed border-overlay-white-30 rounded-xxl"
            style={{ width: ICON_UPLOAD_SIZE, height: ICON_UPLOAD_SIZE }}
          >
            <MaterialIcons name="add-a-photo" size={28} color={colors.text} />
          </Pressable>
          <Text className="text-xs font-body text-ink-muted mt-sm">House icon</Text>
        </View>

        <Input
          label="House name"
          placeholder="e.g. Indie Hackers"
          value={name}
          onChangeText={setName}
          maxLength={NAME_MAX}
          helperText={`${name.length} / ${NAME_MAX}`}
        />

        <Input
          label="Description"
          placeholder="What is this house about?"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
          maxLength={DESC_MAX}
          helperText={`${description.length} / ${DESC_MAX}`}
        />

        <View className="gap-sm">
          <Text className="text-xs font-body-medium text-ink-muted ml-xs">Privacy</Text>
          <View className="gap-sm">
            {PRIVACY_OPTIONS.map(o => (
              <PrivacyRow key={o.id} option={o} selected={privacy === o.id} onPress={setPrivacy} />
            ))}
          </View>
        </View>

        <Button
          label="Create House"
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canCreate}
          loading={createHouse.isPending}
          onPress={handleCreate}
        />
      </ScrollView>
    </View>
  );
};
