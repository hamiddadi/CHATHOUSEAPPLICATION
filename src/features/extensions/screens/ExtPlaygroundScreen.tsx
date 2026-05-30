import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ExtAvailablePeopleStrip } from '../components/ExtAvailablePeopleStrip';
import { ExtBackToRoomBanner } from '../components/ExtBackToRoomBanner';
import { ExtCalendarExportButton } from '../components/ExtCalendarExportButton';
import { ExtCaptionsOverlay } from '../components/ExtCaptionsOverlay';
import { ExtLinkifiedText } from '../components/ExtLinkifiedText';
import { ExtNetworkQualityBars } from '../components/ExtNetworkQualityBars';
import { ExtReactionPicker } from '../components/ExtReactionPicker';
import { ExtShareSheet } from '../components/ExtShareSheet';
import { ExtThemeToggle } from '../components/ExtThemeToggle';
import { ExtUpcomingForYouStrip } from '../components/ExtUpcomingForYouStrip';
import { openInstagramHandle, openTwitterHandle } from '../utils/socialDeepLink';
import { useExtFontScale } from '../hooks/useExtFontScale';
import { useExtWave } from '../hooks/useExtWave';
import { validateInterests } from '../utils/interestsValidator';
// V13-V15 additions
import { ExtBadgesRow } from '../components/ExtBadgesRow';
import { ExtChatReactionsBar } from '../components/ExtChatReactionsBar';

/**
 * Developer playground — renders every extension component in isolation so
 * a tester can verify visually that V1-V10 work on a device. Mount as a
 * temporary route during QA passes.
 *
 * Pure additive — never wired into the legacy navigator by default.
 */
export const ExtPlaygroundScreen: React.FC = () => {
  const [shareOpen, setShareOpen] = useState(false);
  const [reactionOpen, setReactionOpen] = useState(false);
  const [lastReaction, setLastReaction] = useState<string | null>(null);
  const [pickedRoomId, setPickedRoomId] = useState('demo-room-1');
  const [interestsInput, setInterestsInput] = useState('tech, music, startups');
  const fontScale = useExtFontScale();
  const { wave, pending: waving, lastResult } = useExtWave();

  const interestsList = interestsInput
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
  const interestValidation = validateInterests(interestsList);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>Extensions Playground</Text>
        <Text style={styles.muted}>Font scale × {fontScale.toFixed(2)}</Text>

        <Section title="V2 — Theme toggle">
          <ExtThemeToggle />
        </Section>

        <Section title="V1 — Linkified text (chat URL parser)">
          <ExtLinkifiedText style={styles.body}>
            Visit https://clubhouse.com or check chathouse.app/r/demo for more details.
          </ExtLinkifiedText>
        </Section>

        <Section title="V1 — Social deep-links">
          <Row>
            <Btn
              label="Open @clubhouse on Twitter"
              onPress={() => void openTwitterHandle('@clubhouse')}
            />
            <Btn label="Open @instagram" onPress={() => void openInstagramHandle('instagram')} />
          </Row>
        </Section>

        <Section title="V1 — People available to chat">
          <ExtAvailablePeopleStrip onWaveUser={u => void wave(u.id)} />
          <Text style={styles.muted}>
            Wave status: {waving ? 'sending…' : (lastResult ?? 'idle')}
          </Text>
        </Section>

        <Section title="V3 — Upcoming for you">
          <ExtUpcomingForYouStrip emptyHint="No upcoming events for your account yet." />
        </Section>

        <Section title="V4 — Network quality bars">
          <Row>
            <ExtNetworkQualityBars
              report={{ rttMs: 80, jitterMs: 10, packetLossPct: 0, bars: 3, warning: null }}
            />
            <ExtNetworkQualityBars
              report={{ rttMs: 220, jitterMs: 30, packetLossPct: 1, bars: 2, warning: null }}
            />
            <ExtNetworkQualityBars
              report={{ rttMs: 700, jitterMs: 90, packetLossPct: 6, bars: 1, warning: 'poor' }}
            />
            <ExtNetworkQualityBars report={null} />
          </Row>
        </Section>

        <Section title="V8 — Calendar .ics export">
          <Text style={styles.muted}>Room ID:</Text>
          <TextInput
            style={styles.input}
            value={pickedRoomId}
            onChangeText={setPickedRoomId}
            autoCapitalize="none"
          />
          <ExtCalendarExportButton roomId={pickedRoomId} />
        </Section>

        <Section title="V8 — Share sheet">
          <Btn label="Open share sheet" onPress={() => setShareOpen(true)} />
          <ExtShareSheet
            roomId={pickedRoomId}
            visible={shareOpen}
            onClose={() => setShareOpen(false)}
          />
        </Section>

        <Section title="V10 — Reaction picker (long-press emulation)">
          <Btn label="Open reaction picker" onPress={() => setReactionOpen(true)} />
          {lastReaction ? <Text style={styles.muted}>Last picked: {lastReaction}</Text> : null}
          <ExtReactionPicker
            visible={reactionOpen}
            onPick={em => setLastReaction(em)}
            onClose={() => setReactionOpen(false)}
          />
        </Section>

        <Section title="V10 — Captions overlay (fake lines)">
          <View style={styles.captionsCanvas}>
            <ExtCaptionsOverlay
              lines={[
                {
                  id: 'a',
                  speakerId: 'u1',
                  speakerName: 'Alice',
                  text: 'Welcome to the room everyone.',
                  isFinal: true,
                  at: Date.now() - 4000,
                },
                {
                  id: 'b',
                  speakerId: 'u2',
                  speakerName: 'Bob',
                  text: 'Glad to be here.',
                  isFinal: true,
                  at: Date.now() - 2000,
                },
                {
                  id: 'c',
                  speakerId: 'u1',
                  speakerName: 'Alice',
                  text: 'Let us start with the agenda…',
                  isFinal: false,
                  at: Date.now(),
                },
              ]}
            />
          </View>
        </Section>

        <Section title="V2 — Interests validator">
          <TextInput
            style={styles.input}
            value={interestsInput}
            onChangeText={setInterestsInput}
            placeholder="tech, music, startups, …"
            autoCapitalize="none"
          />
          <Text style={[styles.muted, !interestValidation.ok && styles.bad]}>
            {interestValidation.ok
              ? '✓ valid'
              : `✗ ${interestValidation.reason}${
                  interestValidation.missing ? ` (need ${interestValidation.missing} more)` : ''
                }`}
          </Text>
        </Section>

        <Section title="V10 — Back-to-room banner">
          <ExtBackToRoomBanner
            visible
            roomTitle="Late night tech talk"
            hostName="Alice"
            isMuted={false}
            onTapBack={() => undefined}
            onToggleMute={() => undefined}
            onLeave={() => undefined}
          />
        </Section>

        <Section title="V13 — Chat reactions bar (mocked counts)">
          <ExtChatReactionsBar
            messageId="demo-message-1"
            initial={{
              '❤️': { count: 4, byMe: true },
              '🔥': { count: 2, byMe: false },
              '😂': { count: 1, byMe: false },
            }}
          />
          <Text style={styles.muted}>Tap a chip to toggle (would call backend).</Text>
        </Section>

        <Section title="V13 — Badges row (live fetch)">
          <ExtBadgesRow userId={pickedRoomId} />
          <Text style={styles.muted}>
            Uses userId={pickedRoomId} — typically the viewer's own id.
          </Text>
        </Section>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <View style={styles.section}>
    <Text style={styles.h2}>{title}</Text>
    {children}
  </View>
);

const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <View style={styles.row}>{children}</View>
);

const Btn: React.FC<{ label: string; onPress: () => void }> = ({ label, onPress }) => (
  <Pressable
    style={styles.btn}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
  >
    <Text style={styles.btnText}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { padding: 16, gap: 16 },
  h1: { fontSize: 22, fontWeight: '700' },
  h2: { fontSize: 14, fontWeight: '700', color: '#475569', textTransform: 'uppercase' },
  muted: { color: '#64748B', fontSize: 12 },
  bad: { color: '#EF4444' },
  body: { fontSize: 14, color: '#0F172A' },
  section: {
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' },
  input: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    fontSize: 13,
  },
  btn: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  btnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  captionsCanvas: {
    height: 180,
    borderRadius: 12,
    backgroundColor: '#1F2937',
    position: 'relative',
    overflow: 'hidden',
  },
  bottomSpacer: { height: 80 },
});
