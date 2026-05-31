import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { profileLinksApi, type ProfileLink } from '../api/profileLinksApi';
import { apiErrorMessage } from '../utils/extUi';

interface Props {
  userId: string;
  /** Set true when this is the viewer's own profile — unlocks add/remove. */
  editable?: boolean;
}

/** Clubhouse-style cap on custom profile links (server enforces the same). */
const MAX_PROFILE_LINKS = 5;

/**
 * Display + (optional) inline editor for a user's custom profile links
 * (Module 2.2 / PROFIL-008). Backed by the Vague 14 `profileLinksApi`.
 *
 * In view mode: renders chips that open the URL in the system browser.
 * In edit mode: adds a "+ Add link" form at the bottom (label + URL) and a
 * small × on each chip to remove. Server enforces the 5-link cap.
 */
export const ExtProfileLinks: React.FC<Props> = ({ userId, editable = false }) => {
  const [links, setLinks] = useState<ProfileLink[]>([]);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const items = await profileLinksApi.list(userId);
      setLinks(items);
    } catch {
      /* keep stale */
    }
  }, [userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onAdd = async (): Promise<void> => {
    setError(null);
    if (!label.trim() || !url.trim()) {
      setError('Label and URL required');
      return;
    }
    setBusy(true);
    try {
      const items = await profileLinksApi.add({ label: label.trim(), url: url.trim() });
      setLinks(items);
      setLabel('');
      setUrl('');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to add link'));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (id: string): Promise<void> => {
    try {
      const items = await profileLinksApi.remove(id);
      setLinks(items);
    } catch {
      /* keep visible */
    }
  };

  if (links.length === 0 && !editable) return null;

  return (
    <View style={styles.container} accessibilityLabel="Custom profile links">
      <View style={styles.row}>
        {links.map(l => (
          <View key={l.id} style={styles.chip}>
            <Pressable
              onPress={() => void Linking.openURL(l.url).catch(() => undefined)}
              style={styles.chipTap}
              accessibilityRole="link"
              accessibilityLabel={`${l.label} link`}
            >
              {l.icon ? <Text style={styles.icon}>{l.icon}</Text> : null}
              <Text style={styles.label}>{l.label}</Text>
            </Pressable>
            {editable ? (
              <Pressable
                style={styles.remove}
                onPress={() => void onRemove(l.id)}
                accessibilityRole="button"
                accessibilityLabel={`Remove link ${l.label}`}
              >
                <Text style={styles.removeText}>×</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>

      {editable && links.length < MAX_PROFILE_LINKS ? (
        <View style={styles.form}>
          <TextInput
            placeholder="Label (e.g. Newsletter)"
            value={label}
            onChangeText={setLabel}
            style={styles.input}
            maxLength={40}
            autoCapitalize="words"
          />
          <TextInput
            placeholder="https://…"
            value={url}
            onChangeText={setUrl}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            style={[styles.add, busy && styles.addBusy]}
            onPress={() => void onAdd()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Add profile link"
          >
            <Text style={styles.addText}>{busy ? 'Adding…' : '+ Add link'}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 999,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 4,
    gap: 4,
  },
  chipTap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  icon: { fontSize: 13 },
  label: { fontSize: 13, color: '#0F172A', fontWeight: '500' },
  remove: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E2E8F0',
  },
  removeText: { color: '#475569', fontSize: 14, lineHeight: 14 },
  form: { gap: 8 },
  input: {
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
  },
  error: { color: '#EF4444', fontSize: 12 },
  add: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#0F172A',
    borderRadius: 10,
  },
  addBusy: { opacity: 0.5 },
  addText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
});
