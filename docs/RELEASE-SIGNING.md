# Release signing and credentials

ChatHouse has committed bare React Native projects for Android and iOS. Never
commit private signing material, Firebase service accounts or store API keys.

## Android

### Create and store the upload key

```bash
keytool -genkeypair -v \
  -keystore chathouse-upload.jks \
  -alias chathouse \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storetype JKS
```

Keep the keystore in a password manager/secure backup. A local copy may be
placed in `android/app/`; `*.jks` is ignored.

Supply all four values in `~/.gradle/gradle.properties`, `-P` options, or CI
`ORG_GRADLE_PROJECT_*` secrets:

```properties
CHATHOUSE_UPLOAD_STORE_FILE=chathouse-upload.jks
CHATHOUSE_UPLOAD_STORE_PASSWORD=********
CHATHOUSE_UPLOAD_KEY_ALIAS=chathouse
CHATHOUSE_UPLOAD_KEY_PASSWORD=********
```

Release tasks fail immediately if any value is absent. They never fall back to
the shared debug key.

The store-artifact workflow runs `jarsigner -verify -strict`, rejects unsigned
or partially signed entries, debug/weak signers and expired certificates, then
compares the AAB signer SHA-256 with the certificate exported from the protected
upload keystore. The resulting non-secret fingerprint is recorded in the
Android artifact manifest. Keep an independently reviewed copy of that upload
fingerprint in the password manager and Play Console records so a keystore
replacement is an explicit release event.

### Version and build

Choose an explicit, unused `VERSION_CODE` and a release `VERSION_NAME`. Defaults
are for local/technical builds only. From the repository root:

```powershell
.\scripts\build-release-aab.ps1 -VersionCode 42 -VersionName 1.4.0
```

On macOS/Linux, use PowerShell 7 (`pwsh`) to run the same script. Never generate
a store artifact with a raw `gradlew bundleRelease`; the production entrypoint
also validates `.env.production`, Firebase, Maps and signing. Gradle permits a
non-production Release package only when the shared debug key and the explicit
`CHATHOUSE_ALLOW_DEBUG_RELEASE_SIGNING=true` test opt-in are both present.

Release builds use Hermes, R8 code optimization and resource shrinking. Smoke
test the signed artifact on a physical device before uploading.

### Google/Firebase certificate restrictions

Register all relevant SHA-1/SHA-256 fingerprints for package
`com.chathouse.app`:

- local debug key;
- upload key;
- Google Play App Signing key (the certificate users actually receive).

Get local fingerprints with `./gradlew :app:signingReport`. Restrict the Maps
API key to the package plus production signing certificate, and register the
same apps/certificates in Firebase.

## iOS

1. Open `ios/ChatHouse.xcworkspace` in Xcode.
2. Select the `ChatHouse` target and your Apple Developer Team.
3. Keep bundle ID `com.chathouse.app` and enable Push Notifications,
   Background Modes (audio/remote notifications), and Associated Domains.
4. Verify the App ID provisioning profile contains those entitlements.
5. Set `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` to unique values.
6. Choose a generic iOS device and use Product > Archive.

Automatic signing is enabled in the project; CI Simulator builds disable code
signing. For automated App Store delivery, use an App Store Connect API key
stored as CI secrets (`.p8`, issuer ID and key ID). Never commit the key.

Generate and review `Gemfile.lock` and `ios/Podfile.lock` on macOS, then commit
both files. The protected release workflow fails closed when either lockfile is
missing and installs exclusively from those resolved versions.

Firebase Cloud Messaging on iOS also requires an APNs authentication key or
certificate configured in the Firebase console. Push delivery must be tested
on a physical device.

## Shared release configuration

Before any store build:

- use a production `.env` with `ENV=production`, HTTPS API and WSS realtime/
  LiveKit endpoints;
- provide the real Android/iOS Firebase files;
- set Sentry organization, project and auth token if source-map upload is
  required;
- retain signing keys and recovery access in at least two secure locations.

The runtime environment validator rejects localhost and cleartext endpoints in
production bundles.

## Protected CI artifact workflow

Run **Mobile Store Artifacts - Signed Android and iOS** from the reviewed
release commit on `main`. The workflow first requires the complete reusable CI
gate, then produces the two artifact names consumed by the Go-Live preflight:

- `android-production-aab`;
- `ios-production-xcarchive`.

Configure these base64-encoded production files in the protected `production`
GitHub environment:

- `MOBILE_PRODUCTION_ENV_BASE64`;
- `FIREBASE_ANDROID_CONFIG_BASE64`;
- `FIREBASE_IOS_CONFIG_BASE64`;
- `ANDROID_UPLOAD_KEYSTORE_BASE64`;
- `IOS_DISTRIBUTION_CERTIFICATE_BASE64`;
- `IOS_APPSTORE_PROVISIONING_PROFILE_BASE64`.

Also configure the Android signing passwords/alias
(`ANDROID_UPLOAD_STORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS`,
`ANDROID_UPLOAD_KEY_PASSWORD`), the iOS certificate password
(`IOS_DISTRIBUTION_CERTIFICATE_PASSWORD`) and the environment variable
`IOS_TEAM_ID`.

The workflow verifies that the Android bundle is not debug-signed. For iOS it
verifies the archive and exported IPA use the expected Apple Distribution team,
an App Store Connect profile, production APNs entitlement and the requested
version/build. It intentionally does not upload to Play or TestFlight: use the
verified artifacts on the Internal Testing/TestFlight tracks, then record those
external runs in the protected Go-Live evidence. The iOS manifest records
`artifact_sha256` for the exact `ChatHouse.xcarchive.tgz`, `ipa_sha256` for
`ChatHouse.ipa`, and `build_number`; preserve these values with the release
evidence. The Go-Live preflight recomputes both hashes, then compares
`CFBundleIdentifier`, `CFBundleShortVersionString` and `CFBundleVersion`
between the archive and IPA. Evidence for a repackaged or different TestFlight
binary therefore fails closed.
