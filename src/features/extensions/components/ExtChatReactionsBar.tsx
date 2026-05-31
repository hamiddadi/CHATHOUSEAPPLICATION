import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { chatReactionsApi, type ReactionsByEmoji } from '../api/chatReactionsApi';

interface Props {
  messageId: string;
  /**
   * Initial reactions (if the chat list already returned them embedded).
   * Optional — we'll fetch from the server when omitted.
   */
  initial?: ReactionsByEmoji;
  onChange?: (next: ReactionsByEmoji) => void;
}

/**
 * Renders the chip row of reactions attached to a chat message
 * (Module 7.3 / CHAT-007). Tap a chip to add or remove your reaction;
 * the bar updates optimistically and reconciles with the server response.
 *
 * Pair with `ExtReactionPicker` for the long-press picker: the picker
 * returns the chosen emoji, the caller invokes `chatReactionsApi.toggle()`
 * which surfaces here.
 */
export const ExtChatReactionsBar: React.FC<Props> = ({ messageId, initial, onChange }) => {
  const [reactions, setReactions] = useState<ReactionsByEmoji>(initial ?? {});
  const [pending, setPending] = useState<string | null>(null);

  // Compare `initial` by content, not reference: an inline object literal from
  // the parent changes reference every render and would otherwise re-run this
  // effect and clobber the user's optimistic toggle.
  const initialKey = initial ? JSON.stringify(initial) : null;
  useEffect(() => {
    if (initial) {
      setReactions(initial);
      return;
    }
    let cancelled = false;
    chatReactionsApi
      .list(messageId)
      .then(r => {
        if (!cancelled) setReactions(r);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: resync only on id or content change
  }, [messageId, initialKey]);

  const toggle = async (emoji: string): Promise<void> => {
    setPending(emoji);
    // Optimistic update — compute the next map from current state, then apply
    // and notify OUTSIDE the state updater (React may run updater functions
    // more than once, which would fire `onChange` multiple times per toggle).
    const next = { ...reactions };
    const current = next[emoji];
    if (current?.byMe) {
      const c = current.count - 1;
      if (c <= 0) delete next[emoji];
      else next[emoji] = { count: c, byMe: false };
    } else {
      next[emoji] = { count: (current?.count ?? 0) + 1, byMe: true };
    }
    setReactions(next);
    onChange?.(next);
    try {
      const truth = await chatReactionsApi.toggle(messageId, emoji);
      setReactions(truth);
      onChange?.(truth);
    } catch {
      // Rollback to last known good — fetching from server
      try {
        const recovered = await chatReactionsApi.list(messageId);
        setReactions(recovered);
        onChange?.(recovered);
      } catch {
        /* keep optimistic */
      }
    } finally {
      setPending(null);
    }
  };

  const entries = useMemo(
    () => Object.entries(reactions).filter(([, v]) => v.count > 0),
    [reactions],
  );
  if (entries.length === 0) return null;

  return (
    <View style={styles.row} accessibilityRole="text" accessibilityLabel="Message reactions">
      {entries.map(([emoji, { count, byMe }]) => (
        <Pressable
          key={emoji}
          onPress={() => void toggle(emoji)}
          disabled={pending === emoji}
          style={[styles.chip, byMe && styles.chipMine]}
          accessibilityRole="button"
          accessibilityLabel={`${count} reactions ${emoji}${byMe ? ', you reacted' : ''}`}
        >
          <Text style={styles.emoji}>{emoji}</Text>
          <Text style={[styles.count, byMe && styles.countMine]}>{count}</Text>
        </Pressable>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    gap: 4,
  },
  chipMine: { backgroundColor: '#DBEAFE' },
  emoji: { fontSize: 13 },
  count: { fontSize: 11, color: '#475569', fontWeight: '600' },
  countMine: { color: '#1D4ED8' },
});
