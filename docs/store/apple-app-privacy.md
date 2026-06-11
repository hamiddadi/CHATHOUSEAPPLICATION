# Apple App Store — App Privacy (nutrition labels) answer sheet

Fill into **App Store Connect → App Privacy**. Same data surface as the Google
Data Safety sheet. Chathouse does **no tracking** (no ad SDKs, no IDFA, no
data brokers), so answer **"No, we do not use data for tracking."**

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
| Purchases    | Purchase History    | App Functionality (tips / premium via Stripe)   |
| Usage Data   | Product Interaction | App Functionality                               |

## Data not linked to you

| Category    | Data type        | Purpose                    |
| ----------- | ---------------- | -------------------------- |
| Diagnostics | Crash Data       | App Functionality (Sentry) |
| Diagnostics | Performance Data | App Functionality (Sentry) |

> Sentry can be configured to scrub PII (`sendDefaultPii: false`) so crash/perf
> data stays "Not Linked". If you enable PII in Sentry, move Diagnostics under
> "Data linked to you" to stay truthful.

## Third-party processors (for your privacy policy, not a label field)

Stripe (payments), Sentry (diagnostics), LiveKit (audio transport),
Expo/FCM/APNs (push delivery), Google Maps SDK (map rendering).
