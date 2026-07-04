import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
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

interface LegalDocProps {
  /** Document heading (h1). */
  title: string;
  /** "Last updated" line shown under the heading. */
  lastUpdated: string;
  /** Sections of the document. */
  children: React.ReactNode;
}

/**
 * Static legal document. Kept in-app rather than as a remote URL so it works
 * offline and the version reviewed at build time matches what the user sees.
 * Update the consuming screen alongside any policy change.
 */
export const LegalDoc: React.FC<LegalDocProps> = ({ title, lastUpdated, children }) => {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        paddingTop: insets.top + spacing.xxl,
        paddingHorizontal: spacing.xxl,
        paddingBottom: insets.bottom + spacing.giant,
        gap: spacing.lg,
      }}
    >
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
