# Apple App Store — App Privacy (nutrition labels) answer sheet

**Legal document set version:** `2026-07-29`
**Status:** DRAFT — NOT SUBMISSION EVIDENCE

> **Working inventory — not submission evidence.** Reconcile every answer with
> the exact signed iOS archive, merged privacy report, enabled production
> configuration and provider contracts before completing App Store Connect.

Fill into **App Store Connect → App Privacy**. This is the console answer sheet;
the matching app-owned declarations are also present in
`ios/ChatHouse/PrivacyInfo.xcprivacy`. ChatHouse does **no tracking** (no ad
SDKs, IDFA, data broker, or cross-app advertising), so answer **"No, we do not
use data for tracking."**

The `ITSAppUsesNonExemptEncryption: false` flag is already set in
`ios/ChatHouse/Info.plist`
(standard HTTPS/WSS only → export-compliance exempt), so the build won't prompt
for encryption docs.

## Data used to track you

**None.** (Do not add anything under "Tracking".)

## Data linked to you (all "App Functionality" purpose unless noted)

| Category     | Data type               | Purpose                                                                  |
| ------------ | ----------------------- | ------------------------------------------------------------------------ |
| Contact Info | Name                    | App Functionality                                                        |
| Contact Info | Email Address           | App Functionality                                                        |
| Contact Info | Phone Number            | App Functionality (OTP)                                                  |
| User Content | Photos or Videos        | App Functionality (profile photo)                                        |
| User Content | Audio Data              | App Functionality (audio rooms, voice messages)                          |
| User Content | Emails or Text Messages | App Functionality (direct/group/room messages)                           |
| User Content | Other User Content      | App Functionality, Product Personalization (room chat, bio, interests)   |
| Identifiers  | User ID                 | App Functionality                                                        |
| Identifiers  | Device ID               | App Functionality (push notifications)                                   |
| Location     | Precise Location        | App Functionality, Product Personalization (map / nearby)                |
| Location     | Coarse Location         | App Functionality, Product Personalization (reduced-accuracy map access) |
| Purchases    | Purchase History        | App Functionality (account history/entitlement)                          |
| Usage Data   | Product Interaction     | App Functionality, Product Personalization                               |
| Usage Data   | Search History          | App Functionality, Product Personalization                               |
| Diagnostics  | Crash Data              | App Functionality                                                        |
| Diagnostics  | Performance Data        | App Functionality                                                        |

Mobile Sentry is off by default, starts only after explicit opt-in, disables
automatic sessions and tracing, and uses `sendDefaultPii: false`. The current
code can nevertheless attach room or feature context to an event. Apple permits
"Not Linked" only where data is de-identified before collection and cannot be
re-linked, so the conservative release answer is **Linked to the user**. Move
Diagnostics to "Not Linked" only after the exact shipped build and Sentry
configuration prove irreversible pre-collection de-identification and no stable
or account context.

Room recording/replays are release-disabled. `Audio Data` remains required
because users may deliberately store private voice messages and LiveKit
ephemerally transports live room audio.

Search queries submitted from Explore are stored in the signed-in account's
search history so users can revisit, remove, or clear them. Apple defines
`Search History` as searches performed in the app, so it is declared as linked
to the user, used for app functionality and product personalization, and not
used for tracking.

The iOS client does not initiate tips or Premium purchases and does not link to
Stripe Checkout or the Stripe billing portal. `Purchase History` remains
declared because an account can retain tip history or a Premium entitlement
created outside the iOS app. Reassess this declaration if those account records
are no longer returned to iOS.

## Third-party processors (for your privacy policy, not a label field)

Stripe (payments), Sentry (opt-in diagnostics), LiveKit (ephemeral live-audio
transport), private S3-compatible object storage (avatars and voice messages),
Twilio (OTP SMS), Firebase/FCM/APNs (push delivery), Resend or the configured
mail provider, CARTO/OpenStreetMap tile services, Apple MapKit and Google Maps
SDK where enabled. Reconcile the list against the exact iOS binary and
production contracts before submission.

App Store Connect still requires a publicly reachable policy URL. Use
`https://api.chathouse.app/privacy` only after the deployed endpoint and final
legal text have been verified.
