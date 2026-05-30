import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { audioApi, type AudioPreferences, type AudioQualityTier } from '../api/audioApi';
import { privacyApi, type PrivacySettings } from '../api/privacyApi';
import { ExtThemeToggle } from '../components/ExtThemeToggle';

/**
 * Consolidated Settings screen that ties together Vague 3 (privacy), Vague
 * 4 (audio quality tiers + drop-in + spatial), and Vague 2 (theme toggle).
 *
 * Pure additive — independent from the legacy SettingsScreen. Mount under
 * its own navigator route or sub-screen.
 */

const TIERS: { value: AudioQualityTier; label: string; hint: string }[] = [
  { value: 'standard', label: 'Standard', hint: '~20 MB/h — voice, low bandwidth' },
  { value: 'high', label: 'High', hint: '~70 MB/h — richer voice' },
  { value: 'music', label: 'Music', hint: '~100 MB/h — full-range stereo' },
];

export const ExtSettingsScreen: React.FC = () => {
  const [audio, setAudio] = useState<AudioPreferences | null>(null);
  const [privacy, setPrivacy] = useState<PrivacySettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [a, p] = await Promise.all([audioApi.get(), privacyApi.get()]);
        if (!cancelled) {
          setAudio(a);
          setPrivacy(p);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateAudio = async (patch: Partial<Omit<AudioPreferences, 'hints'>>): Promise<void> => {
    const next = await audioApi.update(patch);
    setAudio(next);
  };

  const updatePrivacy = async (patch: Partial<PrivacySettings>): Promise<void> => {
    const next = await privacyApi.update(patch);
    setPrivacy(next);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* THEME */}
        <Section title="Appearance">
          <ExtThemeToggle />
        </Section>

        {/* AUDIO */}
        <Section title="Audio quality">
          {TIERS.map(tier => (
            <Pressable
              key={tier.value}
              onPress={() => void updateAudio({ qualityTier: tier.value })}
              style={[styles.tier, audio?.qualityTier === tier.value && styles.tierActive]}
              accessibilityRole="radio"
              accessibilityState={{ selected: audio?.qualityTier === tier.value }}
            >
              <View>
                <Text style={styles.tierLabel}>{tier.label}</Text>
                <Text style={styles.tierHint}>{tier.hint}</Text>
              </View>
              {audio?.qualityTier === tier.value ? <Text style={styles.check}>✓</Text> : null}
            </Pressable>
          ))}
        </Section>

        <Section title="Audio engine">
          <Row
            label="Spatial audio (3D)"
            value={audio?.spatialAudio ?? false}
            onChange={v => void updateAudio({ spatialAudio: v })}
          />
          <Row
            label="Noise suppression (AEC)"
            value={audio?.noiseSuppression ?? true}
            onChange={v => void updateAudio({ noiseSuppression: v })}
          />
          <Row
            label="Drop-in mode (silent join)"
            value={audio?.dropInMode === 'silent'}
            onChange={v => void updateAudio({ dropInMode: v ? 'silent' : 'normal' })}
          />
        </Section>

        {/* PRIVACY */}
        <Section title="Privacy">
          <Row
            label="Private profile"
            value={privacy?.isPrivateAccount ?? false}
            onChange={v => void updatePrivacy({ isPrivateAccount: v })}
          />
          <Row
            label="Allow waves & pings"
            value={privacy?.allowWaves ?? true}
            onChange={v => void updatePrivacy({ allowWaves: v })}
          />
          <Row
            label="Show me on the map"
            value={privacy?.isVisibleOnMap ?? false}
            onChange={v => void updatePrivacy({ isVisibleOnMap: v })}
          />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

const Row: React.FC<{ label: string; value: boolean; onChange: (v: boolean) => void }> = ({
  label,
  value,
  onChange,
}) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Switch value={value} onValueChange={onChange} />
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFFFF' },
  scroll: { padding: 20, gap: 16 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#475569', textTransform: 'uppercase' },
  tier: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tierActive: { borderColor: '#2A8BF2', backgroundColor: '#EFF6FF' },
  tierLabel: { fontSize: 15, fontWeight: '600' },
  tierHint: { fontSize: 12, color: '#64748B', marginTop: 2 },
  check: { color: '#2A8BF2', fontSize: 18, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  rowLabel: { fontSize: 15 },
});
