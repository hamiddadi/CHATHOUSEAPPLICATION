import React, { useEffect, useState } from 'react';
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

/** Shape of the nested error message returned by the API client. */
type ApiError = { response?: { data?: { error?: { message?: string } } } };

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
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async (): Promise<void> => {
    try {
      const me = await nominatorApi.me();
      setRemaining(me.remaining);
      setHistory(me.history);
    } catch {
      /* keep stale */
    }
  };

  useEffect(() => {
    setLoading(true);
    void reload().finally(() => setLoading(false));
  }, []);

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
      const msg = (err as ApiError)?.response?.data?.error?.message;
      setError(msg ?? 'Invitation failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
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
            style={styles.input}
            maxLength={80}
          />
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="+1 555 123 4567"
            style={styles.input}
            keyboardType="phone-pad"
            autoCorrect={false}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            style={[styles.btn, busy && styles.btnBusy]}
            onPress={() => void onInvite()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Send invitation"
          >
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
  container: { padding: 16, gap: 16, backgroundColor: '#FFFFFF', flex: 1 },
  center: { padding: 32, alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '700' },
  badge: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  form: { gap: 10 },
  input: {
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
  },
  error: { color: '#EF4444', fontSize: 12 },
  btn: { backgroundColor: '#2A8BF2', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  btnBusy: { opacity: 0.5 },
  btnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 14 },
  exhausted: { color: '#64748B', fontSize: 13, paddingVertical: 8 },
  historyHeader: { marginTop: 8 },
  historyTitle: { fontSize: 14, fontWeight: '700', color: '#475569' },
  empty: { color: '#94A3B8', paddingVertical: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#F1F5F9',
  },
  dot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotText: { color: '#FFFFFF', fontWeight: '700' },
  itemBody: { flex: 1 },
  itemName: { fontSize: 14, fontWeight: '600' },
  itemMeta: { fontSize: 12, color: '#64748B', marginTop: 1 },
});
