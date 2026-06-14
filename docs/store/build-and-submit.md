# Build & submit — bare React Native Android

> **Updated for the de-Expo migration.** No EAS, no `eas.json`/`app.json`/
> `app.config.js`. The app is built locally / in CI with Gradle and submitted to
> Google Play manually (or via gradle-play-publisher). Signing, keystore, ABIs,
> Maps/Firebase SHA-1 and Play App Signing all live in
> [`docs/RELEASE-SIGNING.md`](../RELEASE-SIGNING.md) — read it first. **Android-only**
> (no iOS target in this repo).

## Build-time configuration (nothing sensitive committed)

Production values are baked in **at build time** — there is no runtime secret
store. Provide them via the channel each one uses:

| Value                                                 | How it's injected (bare RN)                                                     | Why                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `API_BASE_URL`                                        | root `.env` → `react-native-dotenv` (`@env`), read by `src/config/env.ts`       | REST base (must be https — env-guard rejects http/localhost in prod) |
| `WS_BASE_URL`                                         | root `.env`                                                                     | Socket.IO (must be wss)                                              |
| `LIVEKIT_URL`                                         | root `.env`                                                                     | Live audio (must be wss)                                             |
| `REALTIME_ENABLED`                                    | root `.env`                                                                     | Feature flag                                                         |
| `SENTRY_DSN`                                          | root `.env`                                                                     | Crash reporting (runtime)                                            |
| `GOOGLE_MAPS_API_KEY`                                 | env var / Gradle property → `manifestPlaceholders` (`android/app/build.gradle`) | Android Maps SDK (restrict by package + SHA-1 — see RELEASE-SIGNING) |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | env vars / `android/sentry.properties` read by `sentry.gradle` at build         | Source-map upload during the release build                           |

The root `.env` is **gitignored**. For a production build, populate it with prod
values (or have CI write it from secrets) **before** bundling — metro bakes
`@env` into the JS bundle at `bundleRelease` time. `src/config/env.ts` enforces
https/wss in production.

> **Cert pinning changed.** The old `PIN_DOMAIN_API` / `PIN_API_*` env vars drove
> the `with-cert-pinning` Expo config plugin, which is gone. Pinning is now static
> in [`android/app/src/main/res/xml/network_security_config.xml`](../../android/app/src/main/res/xml/network_security_config.xml)
> — edit that file directly to add `<pin-set>` entries for prod domains.

## Steps

1. Set up the upload keystore + `CHATHOUSE_UPLOAD_*` Gradle properties — see
   [`docs/RELEASE-SIGNING.md`](../RELEASE-SIGNING.md) §1–2.
2. Put `android/app/google-services.json` in place (gitignored) and set prod
   values in the root `.env` + `GOOGLE_MAPS_API_KEY` env var.
3. Bump `versionCode` / `versionName` in `android/app/build.gradle`.
4. Build the App Bundle:
   ```bash
   cd android && ./gradlew :app:bundleRelease
   #   → android/app/build/outputs/bundle/release/app-release.aab
   ```
5. Upload `app-release.aab` to **Play Console** (Internal testing → Production),
   or automate with [gradle-play-publisher] using a Play **service-account JSON**.
6. **After the first upload**, register the **Play App Signing** key SHA-1 (plus
   the upload + debug SHA-1) on Firebase and the Maps key — see RELEASE-SIGNING
   §5 (skipping this makes FCM + Maps fail for Play users).
7. Validate on the internal track — confirm live audio end-to-end on real devices
   (LiveKit reachable over wss) and that push arrives.

## Backend production (separate from the app build)

See `backend/docker-compose.prod.yml`, `backend/Caddyfile`, and
`backend/.env.prod.example`. The API image runs `prisma migrate deploy` on boot,
Caddy terminates TLS for `api.chathouse.app` + `livekit.chathouse.app`, and the
CD pipeline (`.github/workflows/cd-production.yml`) deploys on a `v*.*.*` tag.
LiveKit Cloud is the lowest-ops option — just set the three `LIVEKIT_*` values.
Push send-side needs `FIREBASE_SERVICE_ACCOUNT` + `PUSH_DISPATCH_ENABLED=true`
(see `backend/.env.example`).

[gradle-play-publisher]: https://github.com/Triple-T/gradle-play-publisher
