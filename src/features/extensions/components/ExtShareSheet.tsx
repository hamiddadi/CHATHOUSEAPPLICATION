import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Share, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { shareApi, type ShareLinks } from '../api/shareApi';
import { colors } from '../../../shared/constants/theme';
import { ExtBottomSheet } from './ExtBottomSheet';

interface Props {
  roomId: string | null;
  visible: boolean;
  onClose: () => void;
}

// Brand names stay verbatim; only the generic "system" fallback is localized
// (its label is resolved at render via i18n, see `optionLabel`).
const OPTIONS = [
  { key: 'twitter', label: 'Twitter / X', emoji: '🐦' },
  { key: 'whatsapp', label: 'WhatsApp', emoji: '💬' },
  { key: 'telegram', label: 'Telegram', emoji: '✈️' },
  { key: 'system', label: null, emoji: '⋯' },
] as const;

/**
 * Bottom-sheet share dialog. Fetches pre-filled share URLs from the
 * Vague 8 backend and dispatches to the relevant native target.
 *
 * Caller controls visibility via the `visible` prop.
 */
export const ExtShareSheet: React.FC<Props> = ({ roomId, visible, onClose }) => {
  const { t } = useTranslation();
  const [links, setLinks] = useState<ShareLinks | null>(null);
  const [loading, setLoading] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);

  useEffect(() => {
    if (!visible) return;
    if (!roomId) {
      setLinks(null);
      setLoading(false);
      return;
    }
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
  }, [retryAttempt, roomId, visible]);

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

  const optionLabel = (opt: (typeof OPTIONS)[number]): string =>
    opt.label ?? t('extensions.share.more', 'More…');

  return (
    <ExtBottomSheet visible={visible} onClose={onClose} sheetStyle={styles.sheet}>
      <Text style={styles.title}>{t('extensions.share.title', 'Share this room')}</Text>
      {loading ? (
        <ActivityIndicator
          style={styles.loader}
          color={colors.primary}
          accessibilityRole="progressbar"
          accessibilityLabel={t('extensions.share.loading', 'Building share links')}
        />
      ) : !links ? (
        <>
          <Text style={styles.error} accessibilityRole="alert">
            {t('extensions.share.error', 'Failed to build share links.')}
          </Text>
          {roomId ? (
            <Pressable
              style={styles.retry}
              onPress={() => setRetryAttempt(attempt => attempt + 1)}
              accessibilityRole="button"
              accessibilityLabel={t('common.retry', 'Retry')}
            >
              <Text style={styles.retryText}>{t('common.retry', 'Retry')}</Text>
            </Pressable>
          ) : null}
        </>
      ) : (
        OPTIONS.map(opt => (
          <Pressable
            key={opt.key}
            style={styles.row}
            onPress={() => void handleOpen(opt.key)}
            accessibilityRole="button"
            accessibilityLabel={t('extensions.share.shareViaA11y', 'Share via {{target}}', {
              target: optionLabel(opt),
            })}
          >
            <Text style={styles.emoji}>{opt.emoji}</Text>
            <Text style={styles.label}>{optionLabel(opt)}</Text>
          </Pressable>
        ))
      )}
      <Pressable
        style={styles.cancel}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('common.cancel', 'Cancel')}
      >
        <Text style={styles.cancelText}>{t('common.cancel', 'Cancel')}</Text>
      </Pressable>
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
  retry: {
    minHeight: 44,
    alignSelf: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  retryText: { color: colors.onPrimary, fontSize: 15, fontWeight: '600' },
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
  cancel: { minHeight: 44, marginTop: 12, paddingVertical: 12, alignItems: 'center' },
  cancelText: { fontSize: 15, color: colors.textMuted },
});
