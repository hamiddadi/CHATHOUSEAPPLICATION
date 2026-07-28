# Environment variables (front-end)

This is a **bare React Native** app (no Expo / EAS). Front-end env values are
inlined into the JS bundle at build time by
[`react-native-dotenv`](https://github.com/goatandsheep/react-native-dotenv)
(configured in `babel.config.js`), imported via `@env`, and validated by Zod in
`src/config/env.ts` (which throws at boot on anything malformed).

Which file is read is controlled by the `ENVFILE` env var (default `.env`):

| Build          | `ENVFILE`         | File read         |
| -------------- | ----------------- | ----------------- |
| Dev (default)  | _(unset)_         | `.env`            |
| Release / prod | `.env.production` | `.env.production` |

## 1. Local dev

Edit the root `.env` (gitignored). Restart Metro after any change so the new
values are re-inlined (`react-native start --reset-cache` if they don't pick up):

```dotenv
API_BASE_URL=http://192.168.137.1:4000/api   # PC LAN/hotspot IP, or 127.0.0.1 over `adb reverse`
WS_BASE_URL=ws://192.168.137.1:4000
REALTIME_ENABLED=true
LIVEKIT_URL=ws://192.168.137.1:7880
GOOGLE_MAPS_API_KEY=...                       # Android Maps (see §3)
```

`ENV` is unset in dev, so `src/config/env.ts` defaults it to `development` and
the production endpoint guard stays off.

## 2. Release / production build

Copy `.env.production.example` to `.env.production` (gitignored) and fill in the
**public** hosts, then use the guarded release entrypoint:

```powershell
# PowerShell — bundles .env.production and signs with the upload keystore
.\scripts\build-release-aab.ps1 -VersionCode 1 -VersionName 1.0.0
# Add -Apk only when a standalone production APK is explicitly needed.
```

On macOS/Linux, run that same script with PowerShell 7 (`pwsh`). A raw
`gradlew bundleRelease` is not a supported store-build path and is rejected
unless it is the explicitly debug-signed technical packaging check used by CI.

`.env.production` MUST set `ENV=production`. On boot, `src/config/env.ts`
fail-fasts if a production build points at a local/dev endpoint or a cleartext
`http://` / `ws://` URL — so `API_BASE_URL` / `WS_BASE_URL` / `LIVEKIT_URL` must
be public `https://` / `wss://` hosts (behind your TLS reverse proxy).

## 3. Google Maps key (Android)

`GOOGLE_MAPS_API_KEY` is **not** an `@env` value — it is injected into the
`AndroidManifest` at build time as a `manifestPlaceholder` from either the
`GOOGLE_MAPS_API_KEY` environment variable or a `GOOGLE_MAPS_API_KEY=...` line in
`~/.gradle/gradle.properties` (see `android/app/build.gradle`). Restrict the key
by package (`com.chathouse.app`) + the Play App-Signing SHA-1.

## 4. Optional Sentry source-map upload

`SENTRY_DSN` is the public runtime endpoint inlined into the app. Release
source-map upload is a separate build-time operation and only runs when the
build environment provides all three secrets/identifiers:
`SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT`. Never put the auth token
in `.env.production` because that file is bundled into the application. If the
three build variables are absent, the Android build skips the upload without
failing; CI can also set `SENTRY_DISABLE_AUTO_UPLOAD=true` explicitly.

## Adding a new front-end env var

1. Add it to `.env` (dev) and `.env.production.example` (template).
2. Add it to `envSchema` **and** the `@env` import + `extra` object in
   `src/config/env.ts`.
3. Reference it via `env.MY_VAR` in code.

> Never commit real `.env` / `.env.production` files — only the `*.example`
> templates are tracked. Backend/server env vars live in `backend/.env*` and
> `README.env.md` does not cover them (see `backend/.env.example*`).
