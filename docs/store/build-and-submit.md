# Build & submit — required EAS secrets and steps

The mobile app reads production values from EAS secrets at build time (injected
into `app.config.js`). Nothing sensitive is committed. Set these once with
`eas secret:create` (or in the EAS dashboard) before a production build.

## Required EAS secrets (client build)

| Secret                | Example                                            | Why                                                                  |
| --------------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| `API_BASE_URL`        | `https://api.chathouse.app/api`                    | REST base (must be https — env-guard rejects http/localhost in prod) |
| `WS_BASE_URL`         | `wss://api.chathouse.app`                          | Socket.IO (must be wss)                                              |
| `LIVEKIT_URL`         | `wss://livekit.chathouse.app` or LiveKit Cloud wss | Live audio (must be wss)                                             |
| `GOOGLE_MAPS_API_KEY` | `AIza…`                                            | Android Maps SDK (restrict by package + signing SHA-1)               |
| `SENTRY_DSN`          | `https://…@…ingest.sentry.io/…`                    | Crash reporting                                                      |
| `SENTRY_ORG`          | `your-org`                                         | Source-map upload (build)                                            |
| `SENTRY_PROJECT`      | `chathouse`                                        | Source-map upload (build)                                            |
| `SENTRY_AUTH_TOKEN`   | `sntrys_…`                                         | Auth for source-map upload — **secret**                              |
| `APP_ENV`             | `production`                                       | Set by the `production` build profile in `eas.json`                  |

Optional (Module 13 cert-pinning): `PIN_DOMAIN_API`, `PIN_API_PRIMARY`, `PIN_API_BACKUP`.

```bash
eas secret:create --name API_BASE_URL --value "https://api.chathouse.app/api"
eas secret:create --name WS_BASE_URL  --value "wss://api.chathouse.app"
eas secret:create --name LIVEKIT_URL  --value "wss://livekit.chathouse.app"
eas secret:create --name SENTRY_DSN   --value "https://...ingest.sentry.io/..."
eas secret:create --name SENTRY_ORG   --value "your-org"
eas secret:create --name SENTRY_PROJECT --value "chathouse"
eas secret:create --name SENTRY_AUTH_TOKEN --value "sntrys_..." --type string
eas secret:create --name GOOGLE_MAPS_API_KEY --value "AIza..."
```

## Steps

1. `npm i -g eas-cli && eas login`
2. `eas init` — links the project, writes `extra.eas.projectId` into app.json
   (preserved by app.config.js). Add `owner` if building under an org.
3. Set the secrets above.
4. First builds:
   - Android: `eas build -p android --profile production` → `.aab` (multi-ABI on EAS).
   - iOS: `eas build -p ios --profile production` (needs an Apple Developer account;
     EAS auto-provisions the distribution cert + profile and surfaces any native
     LiveKit/WebRTC pod issues on the first run).
5. Validate on internal track / TestFlight — confirm live audio end-to-end on real
   devices (LiveKit reachable over wss).
6. `eas submit -p android` / `eas submit -p ios` (add the Play service account +
   ASC API key to `eas.json submit.production` for unattended submission).

## Backend production (separate from the app build)

See `backend/docker-compose.prod.yml`, `backend/Caddyfile`, and
`backend/.env.prod.example`. The API image runs `prisma migrate deploy` on boot,
Caddy terminates TLS for `api.chathouse.app` + `livekit.chathouse.app`, and the
CD pipeline (`.github/workflows/cd-production.yml`) deploys on a `v*.*.*` tag.
LiveKit Cloud is the lowest-ops option — just set the three `LIVEKIT_*` values.
