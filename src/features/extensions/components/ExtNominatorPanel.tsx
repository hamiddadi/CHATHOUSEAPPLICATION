import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { nominatorApi, type InvitationRecord } from '../api/nominatorApi';
import { apiErrorMessage } from '../utils/extUi';
import { colors } from '../../../shared/constants/theme';

/**
 * Nominator panel — displays the user's remaining invitations + history,
 * plus a quick "invite by phone" form (Module 2.8 / PROFIL-008).
 *
 * Wire under a Settings entry or directly under the profile screen.
 */
export const ExtNominatorPanel: React.FC = () => {
  const [remaining, setRemaining] = useState<number>(0);
  const [history, setHistory] = useState<InvitationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(false);
    try {
      const me = await nominatorApi.me();
      setRemaining(me.remaining);
      setHistory(me.history);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onInvite = async (): Promise<void> => {
    setError(null);
    if (!name.trim() || !phone.trim()) {
      setError('Name and phone required');
      return;
    }
    setBusy(true);
    try {
      const result = await nominatorApi.invite(phone.trim(), name.trim());
      setRemaining(result.remaining);
      setHistory(prev => [result.record, ...prev]);
      setName('');
      setPhone('');
    } catch (err) {
      setError(apiErrorMessage(err, 'Invitation failed'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator
          color={colors.primary}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading invitations"
        />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.center}>
        <Text style={styles.error} accessibilityRole="alert">
          Failed to load your invitations.
        </Text>
        <Pressable
          style={styles.retry}
          onPress={() => void reload()}
          accessibilityRole="button"
          accessibilityLabel="Retry loading invitations"
        >
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Your invitations</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{remaining} left</Text>
        </View>
      </View>

      {remaining > 0 ? (
        <View style={styles.form}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Friend's name"
            placeholderTextColor={colors.textDim}
            style={styles.input}
            maxLength={80}
            accessibilityLabel="Friend's name"
          />
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="+1 555 123 4567"
            placeholderTextColor={colors.textDim}
            style={styles.input}
            keyboardType="phone-pad"
            autoCorrect={false}
            accessibilityLabel="Friend's phone number"
          />
          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Pressable
            style={styles.btn}
            onPress={() => void onInvite()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Send invitation"
            accessibilityState={{ disabled: busy, busy }}
          >
            {busy ? <ActivityIndicator size="small" color={colors.onPrimary} /> : null}
            <Text style={styles.btnText}>{busy ? 'Sending…' : 'Send invitation'}</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.exhausted}>
          No invitations left. Ask an admin or wait for the monthly refresh.
        </Text>
      )}

      <View style={styles.historyHeader}>
        <Text style={styles.historyTitle}>People you've brought in</Text>
      </View>
      {history.length === 0 ? (
        <Text style={styles.empty}>No invitations yet.</Text>
      ) : (
        <FlatList
          data={history}
          keyExtractor={r => r.id}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.dot}>
                <Text style={styles.dotText}>{item.invitedName.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={styles.itemBody}>
                <Text style={styles.itemName}>{item.invitedName}</Text>
                <Text style={styles.itemMeta}>
                  {item.invitedPhone} • {item.acceptedUserId ? 'joined ✓' : 'pending'}
                </Text>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16, backgroundColor: colors.background, flex: 1 },
  center: { padding: 32, alignItems: 'center', gap: 12 },
  retry: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  retryText: { color: colors.onPrimary, fontSize: 13, fontWeight: '600' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  badge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: { color: colors.onPrimary, fontSize: 12, fontWeight: '600' },
  form: { gap: 10 },
  input: {
    backgroundColor: colors.overlayWhite5,
    borderWidth: 1,
    borderColor: colors.outline,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    fontSize: 13,
    color: colors.text,
  },
  error: { color: colors.danger, fontSize: 12, textAlign: 'center' },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 10,
    minHeight: 44,
  },
  btnText: { color: colors.onPrimary, fontWeight: '600', fontSize: 14 },
  exhausted: { color: colors.textMuted, fontSize: 13, paddingVertical: 8 },
  historyHeader: { marginTop: 8 },
  historyTitle: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
  empty: { color: colors.textDim, paddingVertical: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassStrong,
  },
  dot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotText: { color: colors.textMuted, fontWeight: '700' },
  itemBody: { flex: 1 },
  itemName: { fontSize: 14, fontWeight: '600', color: colors.text },
  itemMeta: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
});
