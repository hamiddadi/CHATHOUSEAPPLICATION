import React from 'react';
import { Modal, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

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
 * transparent `Modal`, a dimmed backdrop that closes on tap, the rounded white
 * container (taps inside are swallowed so they don't dismiss), and the grab
 * handle. Sheets supply their own content via `children` and tweak the
 * container with `sheetStyle`.
 */
export const ExtBottomSheet: React.FC<Props> = ({ visible, onClose, sheetStyle, children }) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <Pressable style={styles.backdrop} onPress={onClose}>
      <Pressable style={[styles.sheet, sheetStyle]} onPress={e => e.stopPropagation()}>
        <View style={styles.handle} />
        {children}
      </Pressable>
    </Pressable>
  </Modal>
);

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
  },
});
