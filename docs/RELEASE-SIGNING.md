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
