# Apple App Store — App Privacy (nutrition labels) answer sheet

Fill into **App Store Connect → App Privacy**. This is the console answer sheet;
the matching app-owned declarations are also present in
`ios/ChatHouse/PrivacyInfo.xcprivacy`. Chathouse does **no tracking** (no ad
SDKs, IDFA, data broker, or cross-app advertising), so answer **"No, we do not
use data for tracking."**

The `ITSAppUsesNonExemptEncryption: false` flag is already set in `app.json`
(standard HTTPS/WSS only → export-compliance exempt), so the build won't prompt
for encryption docs.

## Data used to track you

**None.** (Do not add anything under "Tracking".)

## Data linked to you (all "App Functionality" purpose unless noted)

| Category     | Data type           | Purpose                                         |
| ------------ | ------------------- | ----------------------------------------------- |
| Contact Info | Name                | App Functionality                               |
| Contact Info | Email Address       | App Functionality                               |
| Contact Info | Phone Number        | App Functionality (OTP)                         |
| User Content | Photos or Videos    | App Functionality (profile photo)               |
| User Content | Audio Data          | App Functionality (audio rooms, voice messages) |
| User Content | Other User Content  | App Functionality (messages, room chat, bio)    |
| Identifiers  | User ID             | App Functionality                               |
| Identifiers  | Device ID           | App Functionality (push notifications)          |
| Location     | Precise Location    | App Functionality (map / nearby)                |
| Location     | Coarse Location     | App Functionality (reduced-accuracy map access) |
| Purchases    | Purchase History    | App Functionality (tips / premium via Stripe)   |
| Usage Data   | Product Interaction | App Functionality, Product Personalization      |

## Data not linked to you

| Category    | Data type        | Purpose                    |
| ----------- | ---------------- | -------------------------- |
| Diagnostics | Crash Data       | App Functionality (Sentry) |
| Diagnostics | Performance Data | App Functionality (Sentry) |

Mobile Sentry is off by default, starts only after explicit opt-in, disables
automatic sessions and tracing, and uses `sendDefaultPii: false`. Keep
Diagnostics as "Not Linked" only while that remains true; any future user ID,
email, request body or stable device linkage requires moving it to "Linked".

Room recording/replays are release-disabled. `Audio Data` remains required
because users may deliberately store private voice messages and LiveKit
ephemerally transports live room audio.

## Third-party processors (for your privacy policy, not a label field)

Stripe (payments), Sentry (opt-in diagnostics), LiveKit (ephemeral live-audio
transport), private S3-compatible object storage (avatars and voice messages),
Twilio (OTP SMS), Firebase/FCM/APNs (push delivery), and Google Maps SDK (map
rendering).

App Store Connect still requires a publicly reachable policy URL. Use
`https://api.chathouse.app/privacy` only after the deployed endpoint and final
legal text have been verified.
