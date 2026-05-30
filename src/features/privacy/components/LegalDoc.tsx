import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../../../shared/constants/theme';

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
    <Text style={styles.sectionTitle}>{title}</Text>
    <View style={styles.sectionBody}>{children}</View>
  </View>
);

/** A single body paragraph of legal text. */
export const LegalParagraph: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text style={styles.body}>{children}</Text>
);

/** Inline-styled e-mail address (primary colour), used inside a paragraph. */
export const LegalEmail: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text style={styles.email}>{children}</Text>
);

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
        <Text style={styles.h1}>{title}</Text>
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
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 8,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  body: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  sectionBody: { gap: 6 },
  email: { color: colors.primary },
});
