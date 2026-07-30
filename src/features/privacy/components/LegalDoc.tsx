import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing } from '../../../shared/constants/theme';

/**
 * Shared building blocks for static in-app legal documents (privacy policy,
 * terms of use, …). These screens share an identical layout: a scrollable
 * container honouring the safe area, a heading with a "last updated" line,
 * then a list of titled sections containing paragraphs.
 *
 * Extracted so both documents stay visually consistent and edits to the
 * shared chrome happen in one place. The rendered output is identical to the
 * previous per-screen implementations.
 */

interface LegalSectionProps {
  title: string;
  children: React.ReactNode;
}

/** A titled card grouping one or more {@link LegalParagraph}s. */
export const LegalSection: React.FC<LegalSectionProps> = ({ title, children }) => (
  <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>
      {title}
    </Text>
    <View style={styles.sectionBody}>{children}</View>
  </View>
);

/** A single body paragraph of legal text. */
export const LegalParagraph: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text style={styles.body}>{children}</Text>
);

/**
 * Inline tappable e-mail address (primary colour), used inside a paragraph.
 * Opens the device mail composer via a `mailto:` link. When the child is a
 * plain string it's used verbatim as the address; otherwise pass an explicit
 * `address` prop.
 */
export const LegalEmail: React.FC<{ children: React.ReactNode; address?: string }> = ({
  children,
  address,
}) => {
  const email = address ?? (typeof children === 'string' ? children : undefined);
  return (
    <Text
      style={styles.email}
      accessibilityRole="link"
      onPress={
        email
          ? () => {
              // Best-effort: no mail client → openURL rejects, which we swallow.
              void Linking.openURL(`mailto:${email}`).catch(() => undefined);
            }
          : undefined
      }
    >
      {children}
    </Text>
  );
};

/** Inline link to the canonical published legal document. */
export const LegalLink: React.FC<{ children: React.ReactNode; url: string }> = ({
  children,
  url,
}) => (
  <Text
    style={styles.email}
    accessibilityRole="link"
    onPress={() => {
      void Linking.openURL(url).catch(() => undefined);
    }}
  >
    {children}
  </Text>
);

interface LegalDocProps {
  /** Stable native accessibility identifier used by mobile E2E tests. */
  testID?: string;
  /** Document heading (h1). */
  title: string;
  /** "Last updated" line shown under the heading. */
  lastUpdated: string;
  /** Explicit navigation control: legal screens otherwise have no visible header. */
  onBack?: () => void;
  /** Localized screen-reader label for the back control. */
  backLabel?: string;
  /** Sections of the document. */
  children: React.ReactNode;
}

/**
 * Static legal summary. It remains readable offline while the consuming screen
 * links to the canonical published document. Update both the summary and its
 * build-time version alongside any policy change.
 */
export const LegalDoc: React.FC<LegalDocProps> = ({
  testID,
  title,
  lastUpdated,
  onBack,
  backLabel = 'Back',
  children,
}) => {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      testID={testID}
      className="flex-1 bg-background"
      contentContainerStyle={{
        paddingTop: insets.top + spacing.xxl,
        paddingHorizontal: spacing.xxl,
        paddingBottom: insets.bottom + spacing.giant,
        gap: spacing.lg,
      }}
    >
      {onBack ? (
        <Pressable
          testID={testID ? `${testID}-back` : undefined}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          hitSlop={12}
          style={styles.back}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
      ) : null}
      <View>
        <Text accessibilityRole="header" style={styles.h1}>
          {title}
        </Text>
        <Text style={styles.lastUpdated}>{lastUpdated}</Text>
      </View>
      {children}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -10,
  },
  h1: { color: colors.text, fontSize: 24, fontWeight: '700', marginBottom: 4 },
  lastUpdated: { color: colors.textMuted, fontSize: 11 },
  section: {
    backgroundColor: colors.overlayWhite4,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    gap: 8,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  body: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  sectionBody: { gap: 6 },
  email: { color: colors.primary },
});
