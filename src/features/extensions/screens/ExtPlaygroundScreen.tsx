import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
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
import { colors } from '../../../shared/constants/theme';

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
  const { t } = useTranslation();

  const interestsList = interestsInput
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
  const interestValidation = validateInterests(interestsList);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>{t('extensions.playground.title', 'Extensions Playground')}</Text>
        <Text style={styles.muted}>
          {t('extensions.playground.fontScale', 'Font scale')} × {fontScale.toFixed(2)}
        </Text>

        <Section title={t('extensions.playground.themeToggleTitle', 'V2 — Theme toggle')}>
          <ExtThemeToggle />
        </Section>

        <Section
          title={t('extensions.playground.linkifiedTitle', 'V1 — Linkified text (chat URL parser)')}
        >
          <ExtLinkifiedText style={styles.body}>
            {t(
              'extensions.playground.linkifiedBody',
              'Visit https://clubhouse.com or check chathouse.app/r/demo for more details.',
            )}
          </ExtLinkifiedText>
        </Section>

        <Section title={t('extensions.playground.socialDeepLinksTitle', 'V1 — Social deep-links')}>
          <Row>
            <Btn
              label={t('extensions.playground.openTwitter', 'Open @clubhouse on Twitter')}
              onPress={() => void openTwitterHandle('@clubhouse')}
            />
            <Btn
              label={t('extensions.playground.openInstagram', 'Open @instagram')}
              onPress={() => void openInstagramHandle('instagram')}
            />
          </Row>
        </Section>

        <Section
          title={t('extensions.playground.availablePeopleTitle', 'V1 — People available to chat')}
        >
          <ExtAvailablePeopleStrip onWaveUser={u => void wave(u.id)} />
          <Text style={styles.muted}>
            {t('extensions.playground.waveStatus', 'Wave status')}:{' '}
            {waving
              ? t('extensions.playground.waving', 'sending…')
              : (lastResult ?? t('extensions.playground.idle', 'idle'))}
          </Text>
        </Section>

        <Section title={t('extensions.playground.upcomingTitle', 'V3 — Upcoming for you')}>
          <ExtUpcomingForYouStrip
            emptyHint={t(
              'extensions.playground.upcomingEmpty',
              'No upcoming events for your account yet.',
            )}
          />
        </Section>

        <Section
          title={t('extensions.playground.networkQualityTitle', 'V4 — Network quality bars')}
        >
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

        <Section
          title={t('extensions.playground.calendarExportTitle', 'V8 — Calendar .ics export')}
        >
          <Text style={styles.muted}>{t('extensions.playground.roomId', 'Room ID')}:</Text>
          <TextInput
            style={styles.input}
            value={pickedRoomId}
            onChangeText={setPickedRoomId}
            autoCapitalize="none"
          />
          <ExtCalendarExportButton roomId={pickedRoomId} />
        </Section>

        <Section title={t('extensions.playground.shareSheetTitle', 'V8 — Share sheet')}>
          <Btn
            label={t('extensions.playground.openShareSheet', 'Open share sheet')}
            onPress={() => setShareOpen(true)}
          />
          <ExtShareSheet
            roomId={pickedRoomId}
            visible={shareOpen}
            onClose={() => setShareOpen(false)}
          />
        </Section>

        <Section
          title={t(
            'extensions.playground.reactionPickerTitle',
            'V10 — Reaction picker (long-press emulation)',
          )}
        >
          <Btn
            label={t('extensions.playground.openReactionPicker', 'Open reaction picker')}
            onPress={() => setReactionOpen(true)}
          />
          {lastReaction ? (
            <Text style={styles.muted}>
              {t('extensions.playground.lastPicked', 'Last picked')}: {lastReaction}
            </Text>
          ) : null}
          <ExtReactionPicker
            visible={reactionOpen}
            onPick={em => setLastReaction(em)}
            onClose={() => setReactionOpen(false)}
          />
        </Section>

        <Section
          title={t('extensions.playground.captionsTitle', 'V10 — Captions overlay (fake lines)')}
        >
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

        <Section title={t('extensions.playground.interestsTitle', 'V2 — Interests validator')}>
          <TextInput
            style={styles.input}
            value={interestsInput}
            onChangeText={setInterestsInput}
            placeholder={t(
              'extensions.playground.interestsPlaceholder',
              'tech, music, startups, …',
            )}
            autoCapitalize="none"
          />
          <Text style={[styles.muted, !interestValidation.ok && styles.bad]}>
            {interestValidation.ok
              ? t('extensions.playground.interestsValid', '✓ valid')
              : `✗ ${interestValidation.reason}${
                  interestValidation.missing
                    ? ` (${t('extensions.playground.interestsNeed', 'need')} ${interestValidation.missing} ${t('extensions.playground.interestsMore', 'more')})`
                    : ''
                }`}
          </Text>
        </Section>

        <Section title={t('extensions.playground.backToRoomTitle', 'V10 — Back-to-room banner')}>
          <ExtBackToRoomBanner
            visible
            roomTitle={t('extensions.playground.demoRoomTitle', 'Late night tech talk')}
            hostName={t('extensions.playground.demoHostName', 'Alice')}
            isMuted={false}
            onTapBack={() => undefined}
            onToggleMute={() => undefined}
            onLeave={() => undefined}
          />
        </Section>

        <Section
          title={t(
            'extensions.playground.chatReactionsTitle',
            'V13 — Chat reactions bar (mocked counts)',
          )}
        >
          <ExtChatReactionsBar
            messageId="demo-message-1"
            initial={{
              '❤️': { count: 4, byMe: true },
              '🔥': { count: 2, byMe: false },
              '😂': { count: 1, byMe: false },
            }}
          />
          <Text style={styles.muted}>
            {t(
              'extensions.playground.chatReactionsHint',
              'Tap a chip to toggle (would call backend).',
            )}
          </Text>
        </Section>

        <Section title={t('extensions.playground.badgesTitle', 'V13 — Badges row (live fetch)')}>
          <ExtBadgesRow userId={pickedRoomId} />
          <Text style={styles.muted}>
            {t(
              'extensions.playground.badgesHint',
              "Uses userId={{pickedRoomId}} — typically the viewer's own id.",
              { pickedRoomId },
            )}
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
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 16, gap: 16 },
  h1: { fontSize: 22, fontWeight: '700', color: colors.text },
  h2: { fontSize: 14, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  muted: { color: colors.textMuted, fontSize: 12 },
  bad: { color: colors.danger },
  body: { fontSize: 14, color: colors.text },
  section: {
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassStrong,
    gap: 8,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' },
  input: {
    backgroundColor: colors.surfaceHigh,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    fontSize: 13,
    color: colors.text,
  },
  btn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  btnText: { color: colors.onPrimary, fontSize: 13, fontWeight: '600' },
  captionsCanvas: {
    height: 180,
    borderRadius: 12,
    backgroundColor: colors.surfaceLowest,
    position: 'relative',
    overflow: 'hidden',
  },
  bottomSpacer: { height: 80 },
});
