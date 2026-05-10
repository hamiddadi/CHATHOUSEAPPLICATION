import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing } from '../../../shared/constants/theme';

interface AdminHeaderProps {
  title: string;
  /** Optional subtitle rendered just below the title (small caps grey). */
  subtitle?: string;
  /**
   * When true, renders a "✕" close icon instead of the back arrow. Useful
   * for screens reached as modals (none today, but keep the door open).
   */
  closeIcon?: boolean;
  /**
   * Right-side action slot — typically a single icon button (refresh,
   * settings, etc.). Renders inline at the right of the header.
   */
  rightSlot?: React.ReactNode;
}

/**
 * Admin-stack header — back arrow + title. The native stack navigator is
 * configured with `headerShown: false`, so without this component each
 * screen had no visible navigation control beyond the system back gesture.
 * That's a poor UX for moderation surfaces where flow control matters.
 *
 * The header sits flush to the safe-area top inset; embed it as the FIRST
 * child of the screen's root View. The screen's own `paddingTop: insets.top`
 * is incompatible — drop it when adopting this component.
 */
export const AdminHeader: React.FC<AdminHeaderProps> = ({
  title,
  subtitle,
  closeIcon = false,
  rightSlot,
}) => {
  const navigation = useNavigation();
  const handleBack = (): void => {
    if (navigation.canGoBack()) navigation.goBack();
  };

  return (
    <View style={styles.row}>
      <Pressable
        onPress={handleBack}
        accessibilityRole="button"
        accessibilityLabel={closeIcon ? 'Fermer' : 'Retour'}
        hitSlop={12}
        style={styles.iconBtn}
      >
        <MaterialIcons name={closeIcon ? 'close' : 'arrow-back'} size={22} color={colors.text} />
      </Pressable>
      <View style={styles.titleWrap}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.rightSlot}>{rightSlot}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 44,
    gap: spacing.sm,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWrap: { flex: 1 },
  title: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  rightSlot: {
    minWidth: 36,
    alignItems: 'flex-end',
  },
});
