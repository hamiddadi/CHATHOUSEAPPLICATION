import React, { useMemo } from 'react';
import { Linking, StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';
import { colors } from '../../../shared/constants/theme';

interface ExtLinkifiedTextProps extends TextProps {
  children: string;
  linkStyle?: TextStyle;
}

// Conservative URL matcher: http(s)://, www., and bare domain.tld/path forms.
// We avoid markdown autolink ambiguities (greedy trailing punctuation).
// Every branch uses only flat, length-bounded quantifiers (no quantifier nested
// inside an optional/repeated group), so matching stays linear: a long string
// without a link cannot trigger catastrophic backtracking.
const URL_REGEX =
  /\b((?:https?:\/\/|www\.)[^\s<>()[\]"']{1,2000}|[a-zA-Z0-9-]{1,255}\.[a-z]{2,24}\/?[^\s<>()[\]"']{0,2000})\b/gi;

const ensureScheme = (raw: string): string => {
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
};

const trimTrailingPunct = (raw: string): string => raw.replace(/[.,;:!?)\]'""]+$/u, '');

/**
 * Render a string where URLs are tappable. Drop-in <Text> replacement —
 * inherits Text props (numberOfLines, style, etc.) and adds an optional
 * `linkStyle` for tap-targets.
 *
 * Pure addition: existing chat components remain untouched. Consumers can
 * opt-in by importing this component instead of <Text>.
 */
export const ExtLinkifiedText: React.FC<ExtLinkifiedTextProps> = ({
  children,
  linkStyle,
  style,
  ...rest
}) => {
  const parts = useMemo(() => splitWithUrls(children), [children]);

  return (
    <Text style={style} {...rest}>
      {parts.map((part, idx) =>
        part.type === 'url' ? (
          <Text
            key={idx}
            style={[styles.link, linkStyle]}
            onPress={() => {
              const url = ensureScheme(trimTrailingPunct(part.value));
              void Linking.openURL(url).catch(() => undefined);
            }}
            accessibilityRole="link"
            accessibilityLabel={`Open link ${part.value}`}
          >
            {part.value}
          </Text>
        ) : (
          <Text key={idx}>{part.value}</Text>
        ),
      )}
    </Text>
  );
};

const styles = StyleSheet.create({
  link: { color: colors.primary, textDecorationLine: 'underline' },
});

type Segment = { type: 'text' | 'url'; value: string };

const splitWithUrls = (input: string): Segment[] => {
  const out: Segment[] = [];
  let cursor = 0;
  URL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_REGEX.exec(input))) {
    if (match.index > cursor) {
      out.push({ type: 'text', value: input.slice(cursor, match.index) });
    }
    out.push({ type: 'url', value: match[0] });
    cursor = match.index + match[0].length;
  }
  if (cursor < input.length) out.push({ type: 'text', value: input.slice(cursor) });
  return out;
};
