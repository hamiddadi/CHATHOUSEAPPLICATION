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
import { useCreateRoom } from '../../hooks/useRooms';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'CreateRoom'>;

type Visibility = 'public' | 'social' | 'closed';

interface VisibilityOption {
  id: Visibility;
  icon: 'public' | 'people' | 'lock';
  label: string;
  description: string;
}

const VISIBILITY_OPTIONS: readonly VisibilityOption[] = [
  { id: 'public', icon: 'public', label: 'Open', description: 'Anyone in Chathouse can join' },
  { id: 'social', icon: 'people', label: 'Social', description: 'Only people you follow can join' },
  { id: 'closed', icon: 'lock', label: 'Closed', description: 'Only people you invite' },
];

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 200;

interface VisibilityRowProps {
  option: VisibilityOption;
  selected: boolean;
  onPress: (id: Visibility) => void;
}

const VisibilityRow: React.FC<VisibilityRowProps> = memo(({ option, selected, onPress }) => {
  const handlePress = useCallback(() => onPress(option.id), [option.id, onPress]);
  return (
    <Pressable
      onPress={handlePress}
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
VisibilityRow.displayName = 'VisibilityRow';

export const CreateRoomScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [isScheduled, setIsScheduled] = useState(false);

  const createRoom = useCreateRoom();

  const handleClose = useCallback(() => navigation.goBack(), [navigation]);
  const handleStart = useCallback(async () => {
    try {
      await createRoom.mutateAsync({
        title,
        description: description.trim() || undefined,
        visibility,
      });
      navigation.goBack();
    } catch {
      // Surface via a toast later.
    }
  }, [createRoom, description, navigation, title, visibility]);
  const handleToggleSchedule = useCallback(() => setIsScheduled(prev => !prev), []);

  const canStart = title.trim().length > 0 && !createRoom.isPending;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-xxl py-lg">
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close without starting"
          hitSlop={8}
        >
          <MaterialIcons name="close" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-lg font-headline text-ink">Start a Room</Text>
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
        <Input
          label="Topic"
          placeholder="What do you want to talk about?"
          value={title}
          onChangeText={setTitle}
          maxLength={TITLE_MAX}
          helperText={`${title.length} / ${TITLE_MAX}`}
        />

        <Input
          label="Description (optional)"
          placeholder="Give people a sense of what to expect..."
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
          maxLength={DESCRIPTION_MAX}
          helperText={`${description.length} / ${DESCRIPTION_MAX}`}
        />

        <View className="gap-sm">
          <Text className="text-xs font-body-medium text-ink-muted ml-xs">Visibility</Text>
          <View className="gap-sm">
            {VISIBILITY_OPTIONS.map(opt => (
              <VisibilityRow
                key={opt.id}
                option={opt}
                selected={visibility === opt.id}
                onPress={setVisibility}
              />
            ))}
          </View>
        </View>

        <Pressable
          onPress={handleToggleSchedule}
          accessibilityRole="switch"
          accessibilityLabel="Schedule for later"
          accessibilityState={{ checked: isScheduled }}
          className="flex-row items-center gap-md p-lg rounded-md bg-overlay-white-5 border border-overlay-white-10"
        >
          <MaterialIcons name="calendar-today" size={24} color={colors.text} />
          <View className="flex-1">
            <Text className="text-md font-body-bold text-ink">Schedule for later</Text>
            <Text className="text-xs font-body text-ink-muted">
              Pick a date and time to announce your room
            </Text>
          </View>
          <View
            className={
              isScheduled
                ? 'w-[44px] h-[26px] bg-primary rounded-pill'
                : 'w-[44px] h-[26px] bg-surface-high rounded-pill'
            }
          >
            <View
              className={
                isScheduled
                  ? 'w-[22px] h-[22px] rounded-pill bg-white mt-xxs ml-[20px]'
                  : 'w-[22px] h-[22px] rounded-pill bg-ink-muted mt-xxs ml-xxs'
              }
            />
          </View>
        </Pressable>

        <Button
          label="Start Room"
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canStart}
          loading={createRoom.isPending}
          onPress={handleStart}
        />
      </ScrollView>
    </View>
  );
};
