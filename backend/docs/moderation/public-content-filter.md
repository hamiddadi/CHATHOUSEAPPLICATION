# Public text pre-publication filter

Public text accepted by the API is checked before it reaches a service or the
database. The central implementation is
`src/utils/publicContentModeration.ts`; the schemas opt in only for fields that
other users can see:

- direct, group and room chat text;
- room title, description and topic;
- club name, description and rules;
- public profile names and bio;
- custom group titles.

The filter normalizes Unicode (NFKD), removes combining/invisible formatting
characters, maps a small set of common lookalikes and leetspeak, then evaluates
narrow, high-confidence patterns for direct threats/incitement, explicit
self-harm statements and a small set of unambiguous identity slurs. Every
rejection uses the same generic validation message; it does not reveal the
matched rule.

Passwords, tokens, user IDs, searches, report details and moderation reasons
are intentionally outside this filter. That lets users report the exact content
they saw and avoids mutating or rejecting secrets.

## Limits and operational requirements

This is a deterministic first-pass guard, not a complete moderation system. It
cannot reliably understand quotations, reclaimed language, novel obfuscations
or every language. Audio, images, video and live-room speech are not inspected.
Reports, blocking, moderator tools, escalation and timely human responses
remain required. Self-harm reports also require a documented safety-response
flow; a lexical rejection must never be treated as a clinical assessment.

Review false positives and confirmed misses through the moderation process.
Keep additions narrow and covered by both blocked and benign regression tests.
