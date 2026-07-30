# Build and submit the mobile apps

This repository builds Android and iOS directly; Expo/EAS is not used.

## Pre-release gate

Run the same checks as CI:

```bash
npm ci
npm run quality
npm run test:ci

cd backend
npm ci
npm run lint
npm run typecheck
```

Then test live audio, background audio, deep links, notifications, location and
image selection on physical Android and iOS devices.

## Android App Bundle

Configure the upload key as described in
[`RELEASE-SIGNING.md`](../RELEASE-SIGNING.md), provide the production `.env`,
Firebase config and Maps key, then run from the repository root:

```powershell
.\scripts\build-release-aab.ps1 -VersionCode 42 -VersionName 1.4.0
```

On macOS/Linux, run the same script with PowerShell 7 (`pwsh`). Do not create a
store artifact with a raw `gradlew bundleRelease`: the Gradle guard rejects
non-technical Release tasks that have not passed the production environment,
version, Firebase, Maps and upload-signing checks.

Upload `android/app/build/outputs/bundle/release/app-release.aab` to an Internal
testing track first. After Play App Signing is active, register its signing
certificate with Firebase and the Maps API restriction.

For protected CI, dispatch
`.github/workflows/mobile-store-artifacts.yml` from the reviewed release
commit. Its `android-production-aab` artifact is built only after the full CI
gate and the same production/signing guards.

## iOS archive

On macOS:

```bash
npm ci
bundle install
bundle exec pod install --project-directory=ios
open ios/ChatHouse.xcworkspace
```

In Xcode, select the production team/profile, increment version/build, archive,
validate, and distribute to TestFlight. Verify APNs/FCM on a physical TestFlight
device before App Review.

For the current release, verify that neither mobile platform exposes a Premium
subscribe/manage row or tip action, and that no Stripe Checkout or billing
portal can be opened from the app. Do not enable these flows in a store build
until native store billing is shipped or the app is enrolled in, and implements,
an applicable regional alternative-billing program. Also verify that an
existing server-side Premium entitlement does not unlock paid-only mobile
functionality (profile-viewer history or the expanded profile-link allowance).

For command-line CI archives, provide an Apple Distribution certificate,
provisioning profile and App Store Connect API key through the CI secret store.
The protected mobile-artifact workflow produces
`ios-production-xcarchive`, which can then be validated/exported and uploaded
to TestFlight from the authorized App Store Connect account.

## Domain association files

Store review and real devices need the two files described in
[`docs/setup.md`](../setup.md#7-universal-links). Their app identifiers and
certificate fingerprints must match the production signing identities.

## Backend readiness

Mobile release is not complete unless production API, WebSocket and LiveKit
endpoints are publicly reachable over TLS, migrations are deployed, Redis is
healthy, Firebase Admin sending is enabled, and monitoring/alerts are active.

## Store metadata

Complete privacy/data-safety declarations from actual runtime behavior, not
from placeholders. Supporting documents live under `docs/legal/` and
`docs/store/`; confirm them with the product/legal owner before submission.
