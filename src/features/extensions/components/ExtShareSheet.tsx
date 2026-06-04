import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Share, StyleSheet, Text } from 'react-native';
import { shareApi, type ShareLinks } from '../api/shareApi';
import { colors } from '../../../shared/constants/theme';
import { ExtBottomSheet } from './ExtBottomSheet';

interface Props {
  roomId: string | null;
  visible: boolean;
  onClose: () => void;
}

const OPTIONS = [
  { key: 'twitter', label: 'Twitter / X', emoji: '🐦' },
  { key: 'whatsapp', label: 'WhatsApp', emoji: '💬' },
  { key: 'telegram', label: 'Telegram', emoji: '✈️' },
  { key: 'system', label: 'More…', emoji: '⋯' },
] as const;

/**
 * Bottom-sheet share dialog. Fetches pre-filled share URLs from the
 * Vague 8 backend and dispatches to the relevant native target.
 *
 * Caller controls visibility via the `visible` prop.
 */
export const ExtShareSheet: React.FC<Props> = ({ roomId, visible, onClose }) => {
  const [links, setLinks] = useState<ShareLinks | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !roomId) return;
    let cancelled = false;
    setLoading(true);
    setLinks(null);
    shareApi
      .forRoom(roomId)
      .then(r => {
        if (!cancelled) setLinks(r);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, roomId]);

  const handleOpen = async (option: (typeof OPTIONS)[number]['key']): Promise<void> => {
    if (!links) return;
    // openURL rejects when the target app isn't installed (e.g. Telegram), and
    // Share.share can reject too. Swallow so it isn't an unhandled rejection,
    // and always close the sheet (the old code left it open on failure).
    try {
      if (option === 'system') {
        await Share.share({ message: `${links.text} ${links.url}`, url: links.url });
      } else if (option === 'twitter') {
        await Linking.openURL(links.twitter);
      } else if (option === 'whatsapp') {
        await Linking.openURL(links.whatsapp);
      } else if (option === 'telegram') {
        await Linking.openURL(links.telegram);
      }
    } catch {
      /* best-effort share — target app may not be installed */
    } finally {
      onClose();
    }
  };

  return (
    <ExtBottomSheet visible={visible} onClose={onClose} sheetStyle={styles.sheet}>
      <Text style={styles.title}>Share this room</Text>
      {loading ? (
        <ActivityIndicator style={styles.loader} />
      ) : !links ? (
        <Text style={styles.error}>Failed to build share links.</Text>
      ) : (
        <>
          {OPTIONS.map(opt => (
            <Pressable
              key={opt.key}
              style={styles.row}
              onPress={() => void handleOpen(opt.key)}
              accessibilityRole="button"
              accessibilityLabel={`Share via ${opt.label}`}
            >
              <Text style={styles.emoji}>{opt.emoji}</Text>
              <Text style={styles.label}>{opt.label}</Text>
            </Pressable>
          ))}
          <Pressable style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </>
      )}
    </ExtBottomSheet>
  );
};

const styles = StyleSheet.create({
  sheet: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 32,
  },
  loader: { marginVertical: 20 },
  title: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 12,
    textAlign: 'center',
    color: colors.text,
  },
  error: { color: colors.danger, textAlign: 'center', marginVertical: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassStrong,
    gap: 12,
  },
  emoji: { fontSize: 20, width: 28, textAlign: 'center' },
  label: { fontSize: 15, color: colors.text },
  cancel: { marginTop: 12, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 15, color: colors.textMuted },
});
