import React from 'react';
import { Modal, Pressable, StyleSheet, Text } from 'react-native';
import * as Haptics from 'expo-haptics';

interface Props {
  visible: boolean;
  onPick: (emoji: string) => void;
  onClose: () => void;
}

const QUICK = ['❤️', '👏', '🔥', '😂', '🙏', '🎉', '✨', '🤯'] as const;

/**
 * Floating emoji picker triggered by long-press on a chat message or
 * profile avatar (Module 7.3 / CHAT-007). Emits the chosen emoji upstream;
 * the consumer wires it to the existing room reaction service or the
 * legacy chat reaction endpoint.
 */
export const ExtReactionPicker: React.FC<Props> = ({ visible, onPick, onClose }) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <Pressable style={styles.backdrop} onPress={onClose}>
      <Pressable style={styles.pill} onPress={e => e.stopPropagation()}>
        {QUICK.map(em => (
          <Pressable
            key={em}
            style={styles.btn}
            onPress={() => {
              void Haptics.selectionAsync().catch(() => undefined);
              onPick(em);
              onClose();
            }}
            accessibilityRole="button"
            accessibilityLabel={`React with ${em}`}
          >
            <Text style={styles.emoji}>{em}</Text>
          </Pressable>
        ))}
      </Pressable>
    </Pressable>
  </Modal>
);

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  pill: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    gap: 4,
  },
  btn: { padding: 8 },
  emoji: { fontSize: 26 },
});
