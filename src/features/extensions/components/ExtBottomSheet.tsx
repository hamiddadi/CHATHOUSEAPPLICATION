import React from 'react';
import { Modal, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, layout } from '../../../shared/constants/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  /**
   * Per-sheet overrides for the white container (padding, maxHeight, …).
   * Merged on top of the shared base style (background + top radii).
   */
  sheetStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * Shared bottom-sheet scaffolding for the extension sheets: a slide-up
 * transparent `Modal`, a dimmed backdrop that closes on tap, the rounded dark
 * container (taps inside are swallowed so they don't dismiss), and the grab
 * handle. Sheets supply their own content via `children` and tweak the
 * container with `sheetStyle`.
 */
export const ExtBottomSheet: React.FC<Props> = ({ visible, onClose, sheetStyle, children }) => {
  const insets = useSafeAreaInsets();
  const flattenedSheetStyle = StyleSheet.flatten(sheetStyle);
  const requestedBottomPadding =
    flattenedSheetStyle?.paddingBottom ??
    flattenedSheetStyle?.paddingVertical ??
    flattenedSheetStyle?.padding ??
    0;
  const safeBottomPadding =
    typeof requestedBottomPadding === 'number'
      ? requestedBottomPadding + insets.bottom
      : insets.bottom;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessible={false}>
        <Pressable
          style={[styles.sheet, sheetStyle, { paddingBottom: safeBottomPadding }]}
          onPress={event => event.stopPropagation()}
          accessible={false}
          focusable={false}
          accessibilityViewIsModal
        >
          <View style={styles.handle} />
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: colors.modalBackdrop,
  },
  sheet: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    maxHeight: '90%',
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceHigh,
  },
});
