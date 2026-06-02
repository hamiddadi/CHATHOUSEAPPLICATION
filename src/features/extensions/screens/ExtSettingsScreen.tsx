import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { audioApi, type AudioPreferences, type AudioQualityTier } from '../api/audioApi';
import { privacyApi, type PrivacySettings } from '../api/privacyApi';
import { ExtThemeToggle } from '../components/ExtThemeToggle';
import { colors } from '../../../shared/constants/theme';

/**
 * Consolidated Settings screen that ties together Vague 3 (privacy), Vague
 * 4 (audio quality tiers + drop-in + spatial), and Vague 2 (theme toggle).
 *
 * Pure additive — independent from the legacy SettingsScreen. Mount under
 * its own navigator route or sub-screen.
 */

const getTiers = (t: TFunction): { value: AudioQualityTier; label: string; hint: string }[] => [
  {
    value: 'standard',
    label: t('extensions.settings.audioStandard', 'Standard'),
    hint: t('extensions.settings.audioStandardHint', '~20 MB/h — voice, low bandwidth'),
  },
  {
    value: 'high',
    label: t('extensions.settings.audioHigh', 'High'),
    hint: t('extensions.settings.audioHighHint', '~70 MB/h — richer voice'),
  },
  {
    value: 'music',
    label: t('extensions.settings.audioMusic', 'Music'),
    hint: t('extensions.settings.audioMusicHint', '~100 MB/h — full-range stereo'),
  },
];

export const ExtSettingsScreen: React.FC = () => {
  const { t } = useTranslation();
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

  // Optimistically reflect the toggle, then reconcile with the server. On
  // failure, roll back to the previous value and surface the error rather than
  // leaving a rejected promise unhandled (the switch otherwise lied silently).
  const updateAudio = async (patch: Partial<Omit<AudioPreferences, 'hints'>>): Promise<void> => {
    const prev = audio;
    setAudio(a => (a ? { ...a, ...patch } : a));
    try {
      const next = await audioApi.update(patch);
      setAudio(next);
    } catch {
      setAudio(prev);
      Alert.alert(
        t('common.error', 'Something went wrong'),
        t('extensions.settings.saveError', 'Could not save. Please try again.'),
      );
    }
  };

  const updatePrivacy = async (patch: Partial<PrivacySettings>): Promise<void> => {
    const prev = privacy;
    setPrivacy(p => (p ? { ...p, ...patch } : p));
    try {
      const next = await privacyApi.update(patch);
      setPrivacy(next);
    } catch {
      setPrivacy(prev);
      Alert.alert(
        t('common.error', 'Something went wrong'),
        t('extensions.settings.saveError', 'Could not save. Please try again.'),
      );
    }
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
        <Section title={t('extensions.settings.appearance', 'Appearance')}>
          <ExtThemeToggle />
        </Section>

        {/* AUDIO */}
        <Section title={t('extensions.settings.audioQuality', 'Audio quality')}>
          {getTiers(t).map(tier => (
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

        <Section title={t('extensions.settings.audioEngine', 'Audio engine')}>
          <Row
            label={t('extensions.settings.spatialAudio', 'Spatial audio (3D)')}
            value={audio?.spatialAudio ?? false}
            onChange={v => void updateAudio({ spatialAudio: v })}
          />
          <Row
            label={t('extensions.settings.noiseSuppression', 'Noise suppression (AEC)')}
            value={audio?.noiseSuppression ?? true}
            onChange={v => void updateAudio({ noiseSuppression: v })}
          />
          <Row
            label={t('extensions.settings.dropInMode', 'Drop-in mode (silent join)')}
            value={audio?.dropInMode === 'silent'}
            onChange={v => void updateAudio({ dropInMode: v ? 'silent' : 'normal' })}
          />
        </Section>

        {/* PRIVACY */}
        <Section title={t('extensions.settings.privacyTitle', 'Privacy')}>
          <Row
            label={t('extensions.settings.privateProfile', 'Private profile')}
            value={privacy?.isPrivateAccount ?? false}
            onChange={v => void updatePrivacy({ isPrivateAccount: v })}
          />
          <Row
            label={t('extensions.settings.allowWaves', 'Allow waves & pings')}
            value={privacy?.allowWaves ?? true}
            onChange={v => void updatePrivacy({ allowWaves: v })}
          />
          <Row
            label={t('extensions.settings.showOnMap', 'Show me on the map')}
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
  container: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  scroll: { padding: 20, gap: 16 },
  section: { gap: 8 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  tier: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.overlayWhite5,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tierActive: { borderColor: colors.primary, backgroundColor: colors.overlayWhite10 },
  tierLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  tierHint: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  check: { color: colors.primary, fontSize: 18, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  rowLabel: { fontSize: 15, color: colors.text },
});
