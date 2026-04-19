import React, { memo, useCallback } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../../../shared/components/Avatar';
import { useAuthStore } from '../../../auth/store/authStore';
import { useMe } from '../../../profile/hooks/useProfile';
import { DEFAULTS } from '../../../../shared/constants/images';
import { colors, layout, spacing } from '../../../../shared/constants/theme';
import type { SettingsStackParamList } from '../../../../core/navigation/types';

type Nav = NativeStackNavigationProp<SettingsStackParamList, 'Settings'>;

interface RowData {
  id: string;
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  value?: string;
  destructive?: boolean;
}

const ACCOUNT_ROWS: readonly RowData[] = [
  { id: 'edit', icon: 'person', label: 'Edit profile' },
  { id: 'followers', icon: 'group', label: 'Followers & following', value: '1.2k / 480' },
  { id: 'interests', icon: 'favorite-border', label: 'Interests' },
];

const PREF_ROWS: readonly RowData[] = [
  { id: 'notifs', icon: 'notifications-none', label: 'Notifications' },
  { id: 'privacy', icon: 'lock-outline', label: 'Privacy & safety' },
  { id: 'language', icon: 'language', label: 'Language', value: 'English' },
];

const SUPPORT_ROWS: readonly RowData[] = [
  { id: 'help', icon: 'help-outline', label: 'Help & feedback' },
  { id: 'terms', icon: 'description', label: 'Terms of service' },
  { id: 'signout', icon: 'logout', label: 'Sign out', destructive: true },
];

interface RowProps {
  row: RowData;
  onPress: (id: string) => void;
}

const Row: React.FC<RowProps> = memo(({ row, onPress }) => {
  const handle = useCallback(() => onPress(row.id), [onPress, row.id]);
  return (
    <Pressable
      onPress={handle}
      accessibilityRole="button"
      accessibilityLabel={row.label}
      className="flex-row items-center gap-md p-md rounded-md bg-overlay-white-5 border border-overlay-white-10"
    >
      <MaterialIcons
        name={row.icon}
        size={22}
        color={row.destructive ? colors.danger : colors.text}
      />
      <Text
        className={
          row.destructive
            ? 'flex-1 text-md font-body-bold text-danger'
            : 'flex-1 text-md font-body-medium text-ink'
        }
      >
        {row.label}
      </Text>
      {row.value && <Text className="text-sm font-body text-ink-muted">{row.value}</Text>}
      {!row.destructive && (
        <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} />
      )}
    </Pressable>
  );
});
Row.displayName = 'Row';

interface SectionProps {
  label: string;
  rows: readonly RowData[];
  onPressRow: (id: string) => void;
}

const Section: React.FC<SectionProps> = memo(({ label, rows, onPressRow }) => (
  <View className="gap-sm">
    <Text className="text-xxs font-body-bold text-ink-muted tracking-widest uppercase ml-xs">
      {label}
    </Text>
    <View className="gap-sm">
      {rows.map(r => (
        <Row key={r.id} row={r} onPress={onPressRow} />
      ))}
    </View>
  </View>
));
Section.displayName = 'Section';

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const signOut = useAuthStore(s => s.signOut);
  const { data: user } = useMe();

  const handleOpenProfile = useCallback(
    () => navigation.navigate('Profile', undefined),
    [navigation],
  );

  const handleAccountRow = useCallback(
    (id: string) => {
      if (id === 'edit') navigation.navigate('EditProfile');
      else if (id === 'followers' && user) {
        navigation.navigate('Followers', { userId: user.id });
      }
    },
    [navigation, user],
  );

  const handleSupportRow = useCallback(
    (id: string) => {
      if (id === 'signout') {
        void signOut();
      }
    },
    [signOut],
  );

  const handlePrefRow = useCallback((_id: string) => {
    // Navigate to sub-screens once built.
  }, []);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="px-xxl py-lg">
        <Text className="text-xxl font-display text-ink tracking-tight">Settings</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: spacing.xxl,
          paddingBottom:
            insets.bottom + layout.tabBarHeight + layout.tabBarBottomOffset + spacing.huge,
          gap: spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          onPress={handleOpenProfile}
          accessibilityRole="button"
          accessibilityLabel="Open my profile"
          className="flex-row items-center gap-md p-lg rounded-md bg-overlay-white-5 border border-overlay-white-10"
        >
          <Avatar
            uri={user?.avatarUrl ?? DEFAULTS.avatar}
            name={user?.displayName ?? 'You'}
            size="lg"
          />
          <View className="flex-1">
            <Text className="text-md font-body-bold text-ink">
              {user?.displayName ?? 'Your profile'}
            </Text>
            <Text className="text-xs font-body text-ink-muted">
              @{user?.username ?? 'username'}
            </Text>
          </View>
          <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} />
        </Pressable>

        <Section label="Account" rows={ACCOUNT_ROWS} onPressRow={handleAccountRow} />
        <Section label="Preferences" rows={PREF_ROWS} onPressRow={handlePrefRow} />
        <Section label="Support" rows={SUPPORT_ROWS} onPressRow={handleSupportRow} />
      </ScrollView>
    </View>
  );
};
