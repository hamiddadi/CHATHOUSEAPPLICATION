import type { ZodEffects, ZodString } from 'zod';

export const PUBLIC_CONTENT_REJECTION_MESSAGE =
  'This content cannot be published. Please revise it and try again.';

export type PublicContentViolation = 'threat_or_incitement' | 'self_harm' | 'explicit_slur';

type ModerationRuleGroup = {
  violation: PublicContentViolation;
  patterns: readonly RegExp[];
};

// A deliberately small set of common Unicode lookalikes. NFKD handles
// compatibility characters (full-width text, mathematical alphabets, etc.);
// this map closes the most common Cyrillic/Greek substitutions used to evade
// a Latin-script phrase check.
const CONFUSABLES: Readonly<Record<string, string>> = {
  '\u0430': 'a',
  '\u03b1': 'a',
  '\u0432': 'b',
  '\u03b2': 'b',
  '\u0435': 'e',
  '\u03b5': 'e',
  '\u0456': 'i',
  '\u03b9': 'i',
  '\u043a': 'k',
  '\u03ba': 'k',
  '\u043c': 'm',
  '\u03bc': 'm',
  '\u043d': 'n',
  '\u03bd': 'n',
  '\u03bf': 'o',
  '\u043e': 'o',
  '\u0440': 'p',
  '\u03c1': 'p',
  '\u0441': 'c',
  '\u0442': 't',
  '\u03c4': 't',
  '\u0445': 'x',
  '\u03c7': 'x',
  '\u0443': 'y',
};

const LEET_CHARACTERS: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};

const RULE_GROUPS: readonly ModerationRuleGroup[] = [
  {
    violation: 'threat_or_incitement',
    patterns: [
      /\bkill\s+(?:yourself|yourselves)\b/,
      /\byou\s+should\s+(?:kill\s+yourself|die)\b/,
      /\b(?:i\s+(?:will|ll)|i\s+(?:am|m)\s+(?:going\s+to|gonna))\s+(?:kill|murder|shoot|stab|rape)\s+(?:you|u)\b/,
      /\b(?:we\s+should|lets|let\s+us)\s+(?:kill|murder|exterminate)\s+(?:them|him|her|all\s+of\s+them)\b/,
      /\b(?:je|j)\s+vais\s+(?:te|vous)\s+(?:tuer|violer|poignarder|abattre)\b/,
      /\b(?:tue|tuez)\s+(?:toi|vous)\b/,
      /\bva\s+te\s+(?:tuer|suicider)\b/,
      /\btu\s+devrais\s+(?:mourir|te\s+suicider)\b/,
      /\bon devrait (?:tuer|exterminer)\b/,
      /\bon devrait les (?:tuer|exterminer)\b/,
      /\bil faut (?:tuer|exterminer)\b/,
      /\bil faut les (?:tuer|exterminer)\b/,
      /\bmort\s+aux?\s+(?:juifs?|musulmans?|chretiens?|immigres?|homosexuels?)\b/,
    ],
  },
  {
    violation: 'self_harm',
    patterns: [
      /\bi\s+(?:will|want\s+to|plan\s+to|intend\s+to)\s+(?:kill\s+myself|commit\s+suicide)\b/,
      /\bi\s+(?:am|m)\s+(?:going\s+to|gonna)\s+(?:kill\s+myself|commit\s+suicide)\b/,
      /\bje\s+(?:vais|veux|compte)\s+(?:me\s+tuer|me\s+suicider)\b/,
      /\bje\s+vais\s+mettre\s+fin\s+a\s+mes\s+jours\b/,
    ],
  },
  {
    violation: 'explicit_slur',
    patterns: [
      /\bn\s*i\s*g\s*g\s*(?:e\s*r|a)\s*s?\b/,
      /\bf\s*a\s*g\s*g\s*o\s*t\s*s?\b/,
      /\bb\s*o\s*u\s*g\s*n\s*o\s*u\s*l\s*e\s*s?\b/,
      /\bt\s*r\s*a\s*n\s*n\s*(?:y|ies)\b/,
    ],
  },
];

export function normalizePublicContent(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .replace(/\p{Format}/gu, '')
    .toLowerCase()
    .replace(
      /[\u0430\u03b1\u0432\u03b2\u0435\u03b5\u0456\u03b9\u043a\u03ba\u043c\u03bc\u043d\u03bd\u03bf\u043e\u0440\u03c1\u0441\u0442\u03c4\u0445\u03c7\u0443]/gu,
      character => CONFUSABLES[character] ?? character,
    )
    .replace(/[013457@$]/g, character => LEET_CHARACTERS[character] ?? character)
    .replace(/([a-z])\1{2,}/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function findPublicContentViolation(value: string): PublicContentViolation | null {
  const normalized = normalizePublicContent(value);

  for (const group of RULE_GROUPS) {
    if (group.patterns.some(pattern => pattern.test(normalized))) {
      return group.violation;
    }
  }

  return null;
}

export function isPublicContentAllowed(value: string): boolean {
  return findPublicContentViolation(value) === null;
}

export function publicContentString(schema: ZodString): ZodEffects<ZodString> {
  return schema.refine(isPublicContentAllowed, {
    message: PUBLIC_CONTENT_REJECTION_MESSAGE,
  });
}
