# Environment variables

`app.config.js` reads from `process.env.*` at config-resolution time.
Three ways to provide values, depending on the context:

## 1. Local dev (Expo Go)

Defaults in `app.config.js` cover this (points at `localhost:4000`).
Override any value with a shell export before `npx expo start`:

```bash
API_BASE_URL=http://10.0.2.2:4000/api npx expo start   # Android emulator
REALTIME_ENABLED=true npx expo start                   # enable live socket
```

Or use `.envrc` / direnv to automate.

## 2. EAS Build (staging / production)

Provision each value once as an EAS secret:

```bash
eas secret:create --scope project --name API_BASE_URL --value https://api.chathouse.app/api
eas secret:create --scope project --name WS_BASE_URL  --value wss://api.chathouse.app
eas secret:create --scope project --name REALTIME_ENABLED --value true
eas secret:create --scope project --name SENTRY_DSN   --value https://xxx@sentry.io/yyy
eas secret:create --scope project --name APP_ENV      --value production
```

Then build:

```bash
eas build --platform ios --profile production
eas build --platform android --profile production
```

At build time EAS injects secrets into `process.env.*`, `app.config.js`
consumes them into `extra`, and `src/config/env.ts` validates via Zod.
A missing/invalid secret fails loudly at app boot.

## 3. EAS Update (over-the-air)

Secrets are baked at build time. For runtime-switchable values use
remote config (Statsig, LaunchDarkly, or a `/api/config` endpoint).
Do NOT put secrets in EAS Update payloads — they ship to every device.

## Adding a new env var

1. Add to `app.config.js` → `extra: { MY_VAR: process.env.MY_VAR ?? default }`.
2. Add to `envSchema` in `src/config/env.ts`.
3. Create the EAS secret for non-dev environments.
4. Reference via `env.MY_VAR` in code.
