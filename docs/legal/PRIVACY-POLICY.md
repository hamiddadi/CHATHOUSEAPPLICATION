# ChatHouse — Privacy Policy

**Document version:** `2026-07-29`
**Status:** DRAFT — NOT PUBLISHED
**Language:** English (`en`)

**Effective date:** [publication date]

> **Release blocker — not publishable yet.** Replace every bracketed field,
> verify the service-provider inventory and retention periods against the
> production deployment, obtain legal review, and then assign an immutable
> published version. The application, public web page and Store declarations
> must all identify that same version.

ChatHouse is a social audio application that lets people host and join live
audio rooms, follow and message each other, share voice messages, and discover
people and rooms. This policy explains how personal data is handled when you use
the ChatHouse mobile application and related services.

## 1. Controller and contacts

- **Data controller:** [full registered legal name and legal form]
- **Registered address:** [complete registered address and country]
- **Registration number, if applicable:** [company registration number]
- **Privacy contact:** [operated privacy email address]
- **Data Protection Officer, if appointed:** [DPO name or “Not appointed”]
- **EU/EEA representative, if required:** [representative name/address or “Not
  applicable”]

## 2. Data we process

### Data you provide

- **Required account data:** phone number, one-time-code verification records,
  username and confirmation that you meet the minimum age. Without these data,
  we cannot create or secure an account.
- **Optional profile data:** email address, display name, first and last name,
  profile photo, biography, interests and social links. Omitting these fields
  does not prevent basic account use.
- **User content and social activity:** room titles and topics, live-room
  participation, text and voice messages, reactions, follows, clubs/houses,
  invitations, reports and other content you choose to submit.
- **Support and safety data:** the content of support requests, reports,
  evidence supplied with a report, and moderation correspondence.
- **Purchase information:** an external processor may process a payment if a
  supported purchase flow is enabled. ChatHouse does not receive a full payment
  card number. The service may retain an entitlement, transaction reference,
  status or purchase history associated with the account.

### Data generated or collected when you use the service

- **Live audio:** LiveKit transports live-room audio to room participants.
  ChatHouse's built-in room recording and replay creation are release-disabled.
  A voice message that you deliberately create is stored as private media.
- **Location:** precise or approximate location is optional and off by default.
  It is processed only after the relevant device permission and in-app
  visibility setting are enabled. Other visible users may then see your current
  map position. Disabling visibility or enabling ghost mode clears stored
  coordinates; stale coordinates are also purged.
- **Usage and discovery:** rooms joined, follows, interactions, Explore queries,
  account-linked recent searches, and signals used to provide and personalize
  discovery.
- **Device and network data:** device/platform type, app and OS version, push
  token or device identifier, IP address, user agent, login timestamps and
  security events.
- **Diagnostics:** optional mobile crash reports are disabled until you opt in.
  Restricted server-side error and reliability logs may be processed where
  necessary to secure and operate the service.
- **Map requests:** depending on platform and configuration, map rendering may
  involve CARTO/OSM tiles, Apple MapKit or the Google Maps SDK. Those providers
  can receive technical request data such as IP address, app/device information,
  map interactions and an SDK identifier under their applicable terms.

We do not sell personal data, use it for cross-app advertising or share it with
data brokers. ChatHouse does not use advertising identifiers or track users
across apps or websites owned by other companies.

## 3. Purposes and legal bases

The following table uses GDPR terminology where the GDPR applies. Another
applicable law may describe the same grounds differently.

| Purpose                                               | Data concerned                                      | Legal basis                                                             |
| ----------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| Create, authenticate and manage an account            | Required account, device and security data          | Performance of the user contract                                        |
| Deliver rooms, messages, profiles and social features | Profile, content, activity and live audio           | Performance of the user contract                                        |
| Show the map and nearby/visible users                 | Location and map interactions                       | Consent; withdrawn by disabling visibility/permission                   |
| Provide recent searches and personalized discovery    | Search and usage activity                           | Performance of the user contract; legitimate interests where applicable |
| Deliver notifications                                 | Push token, account and event data                  | Performance of the user contract; device permission/choice              |
| Maintain safety, prevent fraud and enforce rules      | Account, content, reports, device and security data | Legitimate interests; legal obligations                                 |
| Process supported payments and account entitlements   | Account and purchase records                        | Performance of the user contract; legal obligations                     |
| Provide optional mobile diagnostics                   | Crash and performance data                          | Consent                                                                 |
| Operate, debug and secure backend infrastructure      | Restricted server logs and security events          | Legitimate interests; legal obligations                                 |
| Respond to support, privacy and legal requests        | Account, correspondence and verification data       | Contract, legitimate interests and legal obligations                    |

## 4. Recipients and service providers

Data is disclosed only as needed to operate the service, fulfil a user request,
protect users or comply with law:

- other users receive profile, presence, room and message information according
  to the feature used and the user's visibility/privacy choices;
- hosting, database and private object-storage providers;
- LiveKit for real-time audio transport;
- Twilio or the production SMS provider for authentication codes;
- Firebase Cloud Messaging and Apple Push Notification service for push
  notifications;
- Stripe for supported payments, subscription administration and entitlements;
- Sentry for opted-in mobile diagnostics and restricted server reliability
  diagnostics;
- CARTO/OpenStreetMap tile services, Apple MapKit and/or Google Maps Platform,
  depending on the shipped platform and map configuration;
- Resend or the production mail provider for service and support email;
- professional advisers, courts, regulators or competent authorities where
  disclosure is required or legally justified.

Before publication, the operator must verify the exact production vendor list,
each vendor's role (processor or independent controller), contract/DPA, enabled
SDK configuration and countries of processing. If a vendor uses data for its
own purposes, the Store declarations must not incorrectly rely on a
service-provider exemption.

## 5. International transfers

Production data is hosted or accessed in: [list every hosting, storage, support
and processor country/region].

Where personal data is transferred outside the user's country or the EEA, the
transfer mechanism is: [adequacy decision, Standard Contractual Clauses and
supplementary measures, or other reviewed mechanism for each transfer]. A copy
or description of the applicable safeguard can be requested from the privacy
contact, subject to lawful redactions.

## 6. Retention and deletion

Retention is based on the production configuration and applicable legal
requirements:

| Data                                                | Current intended retention                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Active account, profile and user content            | While the account is active and the data is needed to provide the service                                     |
| Self-deleted account and associated private media   | Disabled immediately; 30-day recovery period; permanent purge after the period if not restored                |
| Optional map coordinates                            | Cleared when visibility is disabled/deletion is requested; otherwise purged after about 30 days of inactivity |
| Refresh tokens, OTP and password-reset records      | Removed shortly after expiry or revocation                                                                    |
| Security and database audit logs                    | Normally 90 days                                                                                              |
| Pending phone capability metadata                   | 30 days                                                                                                       |
| Invitation history                                  | Up to one year                                                                                                |
| Payment, fraud, dispute or legally required records | Only the fields and period required by the applicable law or processor obligation                             |
| Infrastructure logs and backups                     | [verified maximum log and backup retention, including deletion propagation time]                              |
| Support and moderation records                      | [verified retention period or objective criteria]                                                             |

An in-app deletion request immediately disables the account, revokes sessions,
removes push tokens and clears map visibility. A successful credential-proven
login during the 30-day recovery period restores a self-deleted account;
moderation suspensions or bans cannot be self-restored. If no restoration
occurs, account records and private media are purged. Narrow records may be
isolated and retained only when required for security, fraud prevention,
disputes or law and are no longer used for normal product features.

Account deletion is available in **Settings → Privacy → Delete my account** and
at `https://api.chathouse.app/account-deletion` once that production page is
published.

## 7. Choices and rights

Depending on applicable law, you may have rights to:

- access and receive a copy of your personal data;
- correct inaccurate or incomplete data;
- erase data or delete the account;
- restrict or object to certain processing;
- receive portable data in a structured format;
- withdraw consent at any time without affecting earlier lawful processing;
- complain to the competent supervisory authority.

The app provides profile editing, data export, location/diagnostics controls and
account deletion. For another request, contact [operated privacy email address].
Where the GDPR applies, we normally respond within one month, subject to lawful
extensions and identity verification.

**Competent supervisory authority:** [authority determined from the controller's
establishment and applicable processing].

## 8. Personalization and automated decisions

Search and activity signals may rank people, rooms or results shown in Explore.
Security systems may flag suspicious activity or possible rule violations.
ChatHouse does not intend to make a solely automated decision that produces
legal or similarly significant effects on a user. If that changes, this policy
will explain the logic, significance, consequences and applicable safeguards.

## 9. Children and child safety

ChatHouse is not directed to children under 16. A user must be at least 16, or
the higher minimum age required in the user's country. We may suspend an account
and delete data if we learn that the age requirement is not met.

Sexual exploitation or abuse of children and child sexual abuse material are
strictly prohibited. See the public **Child Safety Standards** and **Community
Guidelines** for reporting and enforcement information.

## 10. Security

Measures include encryption in transit, one-way hashing of stored credentials
and authentication secrets where applicable, short-lived signed access tokens,
secure device storage, private object storage, access controls, rate limiting
and audit logging. No system can be guaranteed completely secure. We will
notify affected people and authorities when required by applicable law.

## 11. Changes

The effective date and document version will change when this policy is
updated. Material changes will be communicated in the app or by another
appropriate method. Where law requires consent for a new purpose, it will be
requested before that processing begins.

## 12. Contact

- [Full registered legal name]
- [Complete registered address]
- Privacy: [operated privacy email address]
- Support: [operated support email address]
- Telephone: [operated business/support telephone number]
