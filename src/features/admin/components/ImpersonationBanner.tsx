import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useImpersonationStore } from '../store/impersonationStore';

const formatRemaining = (msLeft: number): string => {
  if (msLeft <= 0) return 'expirée';
  const mins = Math.floor(msLeft / 60000);
  const secs = Math.floor((msLeft % 60000) / 1000);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Persistent red banner shown at the top of the app whenever an
 * impersonation session is active. Tappable: opens a confirm to stop
 * the session. The countdown is purely informational — the backend
 * enforces expiry by token TTL.
 */
export const ImpersonationBanner: React.FC = () => {
  const insets = useSafeAreaInsets();
  const token = useImpersonationStore(s => s.token);
  const user = useImpersonationStore(s => s.user);
  const expiresAt = useImpersonationStore(s => s.expiresAt);
  const stop = useImpersonationStore(s => s.stop);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [token]);

  // When the token's TTL elapses we have to clear the store. Doing it
  // inside the render body (the previous `void stop()` call) is a React
  // anti-pattern — it mutates store state during render, which triggers
  // "Cannot update a component while rendering a different component"
  // warnings and can deadlock Suspense boundaries.
  const remaining = expiresAt ? expiresAt - now : 0;
  const expired = Boolean(token && expiresAt && remaining <= 0);
  useEffect(() => {
    if (expired) void stop();
  }, [expired, stop]);

  if (!token || !user || !expiresAt || expired) return null;

  return (
    <View
      style={[styles.banner, { paddingTop: insets.top + 8 }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <MaterialIcons name="visibility" size={18} color="#fff" />
      <View style={styles.textWrap}>
        <Text style={styles.title} numberOfLines={1}>
          Impersonation active — @{user.username ?? user.id}
        </Text>
        <Text style={styles.subtitle}>Expire dans {formatRemaining(remaining)}</Text>
      </View>
      <Pressable
        onPress={() => void stop()}
        style={styles.stopBtn}
        accessibilityRole="button"
        accessibilityLabel="Arrêter l'impersonation"
        hitSlop={8}
      >
        <Text style={styles.stopLabel}>Arrêter</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#dc2626',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 10,
    zIndex: 100,
  },
  title: { color: '#fff', fontSize: 12, fontWeight: '700' },
  subtitle: { color: 'rgba(255,255,255,0.85)', fontSize: 11, marginTop: 1 },
  stopBtn: {
    backgroundColor: 'rgba(0,0,0,0.25)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  stopLabel: { color: '#fff', fontSize: 12, fontWeight: '700' },
  textWrap: { flex: 1 },
});
