# Release signing & store credentials

> **Updated for the de-Expo migration.** This is now a **bare React Native**
> project: `android/` is **committed and hand-maintained** (no `expo prebuild`,
> no EAS Build, no EAS-managed credentials). Signing is done locally / in CI with
> a standard Gradle keystore. iOS is not built from this repo (Android-only).

## TL;DR

- **Never commit a keystore or its passwords.** `.gitignore` excludes `*.jks`,
  `*.keystore`, `*.p8`, `*.p12`, `*.key` (the shared `android/app/debug.keystore`
  is the one intentional exception).
- The release build reads the keystore + passwords from **Gradle properties**
  (`CHATHOUSE_UPLOAD_*`). When they're absent, the `release` build type falls
  back to **debug** signing so a local `assembleRelease` still produces an
  installable — but **NON-shippable** — APK.
- Ship an **`.aab`** (`:app:bundleRelease`) to Google Play; it splits per-ABI
  automatically.

## 1. Generate the upload keystore (one time)

Use the JDK `keytool` (bundled with Android Studio at
`…/Android Studio/jbr/bin/keytool`). Keep the resulting `.jks` and its passwords
in a password manager / secret store — **if you lose them you can no longer
update the app on Google Play.**

```bash
keytool -genkeypair -v \
  -keystore chathouse-upload.jks \
  -alias chathouse \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storetype JKS
# answer the prompts (name/org/…); set a strong store + key password
```

Place `chathouse-upload.jks` in `android/app/` (it is gitignored there).

## 2. Provide the signing credentials (never committed)

Put these where Gradle can read them but git can't — typically
`~/.gradle/gradle.properties` (outside the repo) for local builds, or
`ORG_GRADLE_PROJECT_CHATHOUSE_UPLOAD_*` environment variables / encrypted CI
secrets in CI:

```properties
CHATHOUSE_UPLOAD_STORE_FILE=chathouse-upload.jks
CHATHOUSE_UPLOAD_STORE_PASSWORD=********
CHATHOUSE_UPLOAD_KEY_ALIAS=chathouse
CHATHOUSE_UPLOAD_KEY_PASSWORD=********
```

`android/app/build.gradle` wires these into `signingConfigs.release` and switches
the `release` build type onto it only when `CHATHOUSE_UPLOAD_STORE_FILE` is set.

## 3. Bump the version

Manual now (EAS used to auto-increment). In `android/app/build.gradle`
`defaultConfig`:

- `versionCode` — integer, **must increase** on every Play upload.
- `versionName` — user-facing string (e.g. `1.0.1`).

> **Footgun:** each `versionCode` is consumed **forever across all tracks** —
> once internal-testing/closed-testing has seen a value, you can never reuse it
> (even for a re-upload of a failed build). It currently sits at `1`, so the
> first production submission already needs a bump; start production above
> whatever internal testing has consumed.

## 4. Build a signed release

```bash
cd android

# App Bundle for the Play Store (recommended — per-ABI split delivery):
./gradlew :app:bundleRelease
#   → android/app/build/outputs/bundle/release/app-release.aab

# Or a universal APK (sideload / non-Play distribution):
./gradlew :app:assembleRelease
#   → android/app/build/outputs/apk/release/app-release.apk
```

All four ABIs (`armeabi-v7a, arm64-v8a, x86, x86_64`) are built by default
(`android/gradle.properties` → `reactNativeArchitectures`). On a constrained
machine, override for faster local builds:
`./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a`. A full
4-ABI `bundleRelease` compiles every native target ×4 and is best run in CI / on
a machine with ample RAM.

**R8 / minification is OFF by default** for release
(`android.enableMinifyInReleaseBuilds` is unset). The app ships unminified — fine
for React Native (Hermes already optimises the JS). If you later enable it to
shrink the AAB, set `android.enableMinifyInReleaseBuilds=true`, then do a real
`bundleRelease` + on-device smoke test and expand `android/app/proguard-rules.pro`
as needed.

> **CI guard:** if the `CHATHOUSE_UPLOAD_*` properties are missing, a release
> build does **not** fail — it falls back to **debug** signing and produces a
> debug-signed artifact. Play rejects debug-signed uploads (so it can't ship
> insecurely), but to avoid a wasted CI cycle, assert the env var is present
> before `bundleRelease` in CI, e.g. `test -n "$ORG_GRADLE_PROJECT_CHATHOUSE_UPLOAD_STORE_FILE"`.

## 5. Restrict the Google Maps API key (package + SHA-1)

`react-native-maps` needs the `com.google.android.geo.API_KEY` (injected at build
time via the `GOOGLE_MAPS_API_KEY` Gradle property / env var — never committed).
Lock the key down in **Google Cloud Console → APIs & Services → Credentials →
your key → Application restrictions → Android apps**:

- Package name: `com.chathouse.app`
- SHA-1 certificate fingerprint: add **both** the debug and the release
  fingerprints. Get them with:

```bash
cd android && ./gradlew :app:signingReport
#   → prints SHA1 / SHA-256 for each variant's keystore
```

For reference, the committed **debug** keystore's fingerprint (add this so debug
builds can use Maps/Firebase too):

```
SHA1: 5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25
```

The **release** SHA-1 differs and only appears in `signingReport` once the
`CHATHOUSE_UPLOAD_*` properties point at your real upload keystore.
Add the same SHA-1s to **Firebase console → Project settings → your Android app**
so FCM / any Firebase Android API keeps working for signed builds.

> ### ⚠️ Play App Signing — the load-bearing detail
>
> When you upload an `.aab`, the app is enrolled in **Play App Signing** by
> default: Google **re-signs** the installed app with its own _app-signing key_,
> which is **different** from your upload keystore. So the certificate on a
> Play-installed device is **not** the one `signingReport` prints.
>
> If you register only the upload-key SHA-1 on Firebase/Maps, **FCM push and
> Google Maps will silently fail for every Play-Store user** while working fine
> in your local release build — a production-only break that's painful to debug.
>
> **After the first upload**, go to **Play Console → (your app) → Test and
> release → App integrity → App signing** and copy **both** certificates' SHA-1:
>
> - **App signing key certificate** (Google's — used on real devices)
> - **Upload key certificate** (yours)
>
> Register **both** (plus debug) on the Maps API key restriction **and** on the
> Firebase Android app. The release SHA from `signingReport` = the upload key
> only, and is **not sufficient** once Play App Signing is active.

## 6. Firebase / FCM

`android/app/google-services.json` (gitignored — carries the project API key) must
be present at build time. The release/upload SHA-1 from step 5 must be registered
on the Firebase Android app. Backend push only **sends** when
`FIREBASE_SERVICE_ACCOUNT` (service-account JSON) and `PUSH_DISPATCH_ENABLED=true`
are set on the server — see `backend/.env.example`.

## 7. Store submission

Upload `app-release.aab` to the **Google Play Console** (Internal testing →
Production), or automate with [gradle-play-publisher] / fastlane using a Play
Console **service-account JSON** key (kept out of git). Store-listing
requirements (privacy policy URL, support URL, age rating, Data safety form) are
filled in the Play Console; the hosted legal documents to link are in
[`docs/legal/`](./legal): `PRIVACY-POLICY.md` and `EULA.md`.

[gradle-play-publisher]: https://github.com/Triple-T/gradle-play-publisher
