# ChatHouse — Go-Live checklist

The single ordered path from the current repo state to launch. The **app and
backend are code-complete and verified**; what remains is production provisioning
(accounts, secrets, signing, legal, store assets) — the checkboxes below. Deep
detail lives in the linked docs; this page is the "start here" index.

> **State (2026-07):** frontend `tsc` + `eslint` + `prettier` green; backend
> migration chain complete (`migrate deploy` verified on a fresh DB → exact
> schema); prod compose fail-closes on every required secret; a boot-guard
> rejects dev-default secrets in production. See
> [`backend/docs/deployment/runbook.md`](../backend/docs/deployment/runbook.md)
> and [`docs/store/build-and-submit.md`](store/build-and-submit.md).

## 0. Accounts (do first — everything below depends on them)

- [ ] **Twilio** account + an SMS-capable number (phone + OTP is the ONLY login path).
- [ ] **LiveKit Cloud** project (recommended over self-host) → `wss://` URL + API key/secret.
- [ ] **Firebase** (already `chathouse-6299`) → a **service-account** JSON for push send.
- [ ] **Google Play Console** developer account + a **Google Cloud** project for the Maps key.
- [ ] A **host** (Docker VM) for the backend + a domain (`api.chathouse.app`, …).
- [ ] A **Sentry** project (optional, recommended).

## 1. Backend to production

Detail: [`runbook.md`](../backend/docs/deployment/runbook.md), `backend/.env.prod.example`, `backend/docker-compose.prod.yml`.

- [ ] On the host, copy `.env.prod.example` → `.env` (`chmod 600`) and fill EVERY
      `__CHANGE_ME__`: Postgres/Redis passwords, `JWT_ACCESS_SECRET` /
      `JWT_REFRESH_SECRET` (≥32 chars via `openssl rand -hex 32` — must NOT be the
      dev defaults; the boot-guard rejects them), `CORS_ORIGINS`, the three
      `LIVEKIT_*`, and the three `TWILIO_*`. For push: add `FIREBASE_SERVICE_ACCOUNT`
      (JSON on one line) + `PUSH_DISPATCH_ENABLED=true`.
- [ ] Point DNS at the host; Caddy (in the prod compose) auto-provisions TLS.
- [ ] Configure the GitHub **Secrets** + **Environments** (staging/production) per
      runbook §6, then deploy: push to `main` → staging auto-deploys; tag `v*.*.*`
      → production (behind approval). The api image runs `prisma migrate deploy` on
      boot — the migration chain is complete, so a fresh DB comes up correctly.
- [ ] Smoke-test: `GET /health` → 200 with `database:true` + `redis:true`.

## 2. Mobile release (Android)

Detail: [`RELEASE-SIGNING.md`](RELEASE-SIGNING.md), [`build-and-submit.md`](store/build-and-submit.md), [`README.env.md`](../README.env.md).

- [ ] Generate the **upload keystore** + the four `CHATHOUSE_UPLOAD_*` Gradle props
      (RELEASE-SIGNING §1–2). ⚠️ Back it up — losing it after the first upload means
      you can never update the listing.
- [ ] Put the prod **`android/app/google-services.json`** in place (gitignored).
- [ ] Create **`.env.production`** from `.env.production.example` with the PUBLIC
      `https://` / `wss://` hosts + the Maps key (`ENV=production` arms the boot guard
      that rejects localhost/cleartext).
- [ ] Bump `versionCode` in `android/app/build.gradle` (keep it `1` for the first upload).
- [ ] Build the AAB: `.\scripts\build-release-aab.ps1` (or
      `ENVFILE=.env.production ./android/gradlew -p android bundleRelease`).
- [ ] Upload `app-release.aab` to Play (Internal testing → Production).
- [ ] **After the first upload**, register the **Play App-Signing SHA-1** on Firebase
      and restrict the Maps key to it (RELEASE-SIGNING §5) — else FCM + Maps fail for
      store users.
- [ ] Validate on the internal track: real-device audio (LiveKit over wss) + push arrives.

## 3. Legal & store listing

Detail: `docs/legal/*`, [`listing.md`](store/listing.md), [`google-play-data-safety.md`](store/google-play-data-safety.md).

- [ ] Fill the `[entity]` / `[jurisdiction]` placeholders in `PRIVACY-POLICY.md` +
      `EULA.md`, have counsel review, and **host** them at stable public URLs
      (`https://chathouse.app/privacy`, `/support`) — Play requires resolvable links.
- [ ] Produce store visuals: 2–8 screenshots, a 1024×500 feature graphic, a 512×512
      icon (none exist yet; listing copy is already drafted in `listing.md`).
- [ ] Complete the Play **Data Safety** form + the **foreground-service**
      (microphone / media-playback) use-case declaration + prominent-disclosure
      justification.

## Already DONE — do not redo

Migration drift fixed & verified · prod compose forwards Twilio/FCM (fail-closed) ·
`twilio` dependency added · `ENVFILE`-based release env + `.env.production.example` +
`build-release-aab.ps1` · dev-default-secret boot-guard · self-host LiveKit pinned to
`v1.12.0` · "online now" presence strip wired · release NSC prod-safe · 4 ABIs · EN/FR
i18n parity · all prior security criticals closed (tokenVersion, DM block, ProfileView…).
