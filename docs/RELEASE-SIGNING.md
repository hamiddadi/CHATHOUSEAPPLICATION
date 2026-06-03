# Release signing & store credentials

## TL;DR

This is an Expo **managed** project. `android/` and `ios/` are **gitignored**
(see `.gitignore`) and are regenerated from `app.json` / `app.config.js` on every
`expo prebuild` / EAS Build. Therefore:

- **Do not** rely on or edit `android/app/build.gradle` for signing — it is
  ephemeral. Its scaffolded `release` block points at the **debug** keystore,
  which only ever matters for a local bare `./gradlew assembleRelease` (a path we
  do not use). EAS Build **overrides** that signing config with the real,
  EAS-managed keystore, so EAS release artifacts are correctly signed.
- **Never commit a keystore.** `.gitignore` already excludes `*.jks`, `*.p8`,
  `*.p12`, `*.key`, `*.mobileprovision`. Keep it that way.

Signing is handled by **EAS managed credentials**.

## One-time setup (requires the Expo account)

```bash
# Log in to the Expo account that owns the project
eas login

# Android: generate + store an upload keystore on EAS servers
eas credentials -p android
#   → Build credentials → Keystore → "Set up a new keystore" (EAS generates it)

# iOS: distribution certificate + provisioning profile (needs an Apple account)
eas credentials -p ios
#   → let EAS create/manage the Distribution Certificate and Provisioning Profile
```

EAS stores these securely and injects them at build time. Verify with:

```bash
eas credentials -p android   # shows the stored keystore fingerprint
eas credentials -p ios
```

## Building signed release artifacts

```bash
eas build --profile production --platform android   # → AAB, signed by EAS keystore
eas build --profile production --platform ios       # → IPA, signed by EAS cert
```

Profiles live in `eas.json`. `production` uses `autoIncrement: true` so the
Android `versionCode` / iOS `buildNumber` bump automatically (`appVersionSource:
"remote"` in `eas.json` means EAS, not the local files, owns the build number —
which is why the `versionCode 1` in the ephemeral `build.gradle` is irrelevant).

## Store submission

`eas.json` → `submit.production` is intentionally minimal. Provide the store API
credentials via EAS secrets / interactive prompt rather than committing them:

- **Google Play:** a Play Console **service-account JSON** key.
  `eas submit -p android --profile production` (point it at the key, or set
  `submit.production.android.serviceAccountKeyPath`).
- **App Store:** an **App Store Connect API key** (Issuer ID + Key ID + .p8).
  `eas submit -p ios --profile production`.

Store-listing requirements (privacy policy URL, support URL, age rating, data
safety / app privacy questionnaire) are filled in the Play Console / App Store
Connect. The hosted legal documents to link there are in
[`docs/legal/`](./legal): `PRIVACY-POLICY.md` and `EULA.md`.
