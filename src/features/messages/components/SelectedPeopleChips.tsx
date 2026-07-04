import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../../shared/components/Avatar';
import { colors, spacing } from '../../../shared/constants/theme';
import type { User } from '../../../shared/types/domain';

interface SelectedPeopleChipsProps {
  /** The currently selected people, in insertion order. */
  people: User[];
  /** Remove one person from the selection. */
  onRemove: (user: User) => void;
}

/**
 * Horizontal, scrollable banner of the people you've picked. Each chip has a
 * removable ✕. Rendered above the candidate list so a selection stays visible
 * even after the filter hides the row it came from (audit QA 2026-07-02 —
 * "the filter masks checked people"). Renders nothing when nothing is picked.
 */
export const SelectedPeopleChips: React.FC<SelectedPeopleChipsProps> = ({ people, onRemove }) => {
  const { t } = useTranslation();
  if (people.length === 0) return null;
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {people.map(person => {
        const name = person.displayName || person.username;
        return (
          <Pressable
            key={person.id}
            onPress={() => onRemove(person)}
            accessibilityRole="button"
            accessibilityLabel={t('messages.removeSelected', {
              name,
              defaultValue: `Remove ${name}`,
            })}
            className="flex-row items-center gap-xs bg-surface-high rounded-pill pl-xxs pr-sm py-xxs active:opacity-70"
          >
            <Avatar uri={person.avatarUrl ?? undefined} name={person.displayName} size="sm" />
            <Text className="text-sm font-body-bold text-ink max-w-[120px]" numberOfLines={1}>
              {name}
            </Text>
            <MaterialIcons name="close" size={16} color={colors.textMuted} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingHorizontal: spacing.xxl, paddingBottom: spacing.md },
});
