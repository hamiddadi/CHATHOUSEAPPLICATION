# Chathouse — Privacy Policy

**Last updated: 2026-06-03**

> This document is a launch-ready draft. Before publishing, have it reviewed by
> counsel and fill the bracketed placeholders (`[…]`) with your registered legal
> entity, address, and the supervisory authority for your jurisdiction. Host it
> at a stable public URL and link that URL in App Store Connect and the Google
> Play Console.

Chathouse ("**Chathouse**", "**we**", "**us**") is a social audio application that
lets people host and join live audio rooms, follow each other, exchange direct
and group messages (including voice messages), and discover people and rooms.
This policy explains what personal data we process, why, and the rights you have.

**Data controller:** [Legal entity name], [registered address].
**Contact / Data Protection:** contact@weasydoo.com.

---

## 1. Data we collect

### Information you provide

- **Account & identity:** phone number (used to sign you in via one-time code),
  and optionally email; username, display name, first/last name, bio, profile
  photo, and interests.
- **Content you create:** audio you speak in rooms (and recordings of a room
  **only** when recording is explicitly enabled for that room), text and voice
  messages, room titles/topics, reactions, and reports you submit.
- **Payments:** when you send a tip or subscribe to premium, the payment itself
  is processed by **Stripe**. We do **not** receive or store your full card
  number; we store a payment/subscription reference and status.

### Information collected automatically

- **Location** (only with your permission): approximate/precise location to show
  you and friends on the map and to surface nearby rooms. You can disable this in
  your OS settings or use in-app "ghost mode" to stop sharing.
- **Usage & device data:** rooms joined, follows, app interactions, device type,
  OS version, and app version.
- **Diagnostics:** crash and error reports (via **Sentry**) — collected **only if
  you consent** to diagnostics; otherwise crash reporting is disabled.

We do **not** sell your personal data.

## 2. Why we use it (legal bases — GDPR Art. 6)

| Purpose                                                 | Legal basis                             |
| ------------------------------------------------------- | --------------------------------------- |
| Create and operate your account, deliver rooms/messages | Performance of a contract               |
| Live audio transport and voice messages                 | Performance of a contract               |
| Map / nearby features                                   | Consent (location permission)           |
| Tips & premium subscriptions                            | Performance of a contract               |
| Safety, moderation, abuse prevention                    | Legitimate interests / legal obligation |
| Crash & error diagnostics                               | Consent                                 |
| Security, fraud and rate-limiting                       | Legitimate interests                    |

## 3. Sharing & processors

We share data only with service providers acting on our instructions:

- **LiveKit** — real-time audio transport (and egress for opt-in recordings).
- **Stripe** — payment and subscription processing.
- **Twilio** (or equivalent SMS provider) — sending one-time login codes.
- **Sentry** — crash/error diagnostics (consent-gated).
- **Push providers** (Apple Push Notification service / Firebase Cloud Messaging)
  — delivering notifications.
- **Hosting/infrastructure** — our cloud and database providers.

Other users see the profile, content, and presence you choose to share (e.g.
your speaking in a room, your messages to them, your map presence when enabled).

## 4. International transfers

Where data is transferred outside your region, we rely on appropriate safeguards
such as Standard Contractual Clauses with our processors. [Confirm the regions
and mechanisms applicable to your deployment.]

## 5. Retention

We keep personal data only as long as necessary. Summary (full matrix in
`backend/docs/rgpd/data-retention-policy.md`):

- **Account data:** for the life of your account.
- **Deleted accounts:** soft-deleted immediately and **permanently erased after a
  30-day grace period** by an automated daily purge job.
- **Location:** purged on a rolling basis (≈30 days).
- **Auth artifacts** (refresh tokens, one-time codes, password-reset tokens):
  deleted shortly after expiry/revocation.
- **Audit/security logs:** ~90 days.

## 6. Your rights (GDPR Art. 15–22)

You can:

- **Access / port** your data — in-app **Export my data** produces a machine-
  readable archive of your profile, messages, follows, and activity.
- **Erase** your account and data — in-app **Delete account** (subject to the
  30-day grace window, after which erasure is permanent and automated).
- **Rectify** inaccurate data — edit your profile in-app.
- **Object/restrict** processing and **withdraw consent** (e.g. revoke location
  or diagnostics) at any time.

To exercise rights you cannot complete in-app, contact contact@weasydoo.com. You
also have the right to lodge a complaint with your supervisory authority
([authority for your jurisdiction]).

## 7. Safety & user-generated content

Chathouse has zero tolerance for abusive or objectionable content. You can
**block** users and **report** users or rooms in-app; reports are reviewed and
may lead to content removal or account suspension. See the EULA (`EULA.md`).

## 8. Children

Chathouse is not directed to children. You must be at least **16** (or the older
of 16 and the minimum digital-consent age in your country) to use Chathouse.

## 9. Security

We protect data with encryption in transit, hashed credentials (bcrypt), signed
short-lived access tokens, role-based access control, signed payment/recording
webhooks, and rate limiting. No system is perfectly secure, but we work to
protect your information and will notify you and regulators of breaches as
required by law.

## 10. Changes

We will update this policy as the app evolves and revise the "Last updated" date.
Material changes will be communicated in-app.

## 11. Contact

[Legal entity name], [address] — contact@weasydoo.com.
