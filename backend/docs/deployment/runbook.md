# ChatHouse — Deployment Runbook

Operational guide for shipping the ChatHouse **backend API** (Express 5 /
Prisma / mediasoup) to staging and production via GitHub Actions CD.

The API container is built from `backend/Dockerfile` (multi-stage
`node:22.23.1-slim`, runs `node dist/app.js` under `tini`, `EXPOSE 4000`) and runs
as the `api` service in the host's `docker-compose.yml` alongside `postgres`
and `redis`.

---

## 1. Pipelines at a glance

| Pipeline        | File                                  | Trigger                       | Target     | Approval           |
| --------------- | ------------------------------------- | ----------------------------- | ---------- | ------------------ |
| CI              | `.github/workflows/ci.yml`            | push / PR to `main`,`develop` | —          | none               |
| CD — Staging    | `.github/workflows/cd-staging.yml`    | push to `main`, manual        | staging    | none               |
| CD — Production | `.github/workflows/cd-production.yml` | push tag `v*.*.*`             | production | required reviewers |
| Rollback        | `.github/workflows/rollback.yml`      | manual (`workflow_dispatch`)  | either     | env gate           |

Images are pushed to **GHCR**: `ghcr.io/<owner>/<repo>/api`.

- Staging tags: `staging-<sha>` and `staging-latest`
- Production tags: `<semver>` (e.g. `1.4.2`) and `latest`

---

## 2. Normal flow — deploy to STAGING

Staging deploys are automatic.

1. Merge a PR (or push) to `main`.
2. `cd-staging.yml` runs:
   - **build-and-push** — builds `./backend` and pushes
     `ghcr.io/<owner>/<repo>/api:staging-<sha>` (+ `staging-latest`).
   - **deploy-staging** — SSHes to `STAGING_HOST`, `docker pull`s the new
     image, `docker compose up -d --no-deps api`, then polls `/health` up to
     10× (5s apart). If health never goes green it **auto-rolls back** to the
     previously-running image and the job fails.
   - **notify** — posts success/failure to Slack.
3. Watch the Actions run + the Slack message. Done.

To redeploy the current `main` without a new commit, use **Run workflow**
(`workflow_dispatch`) on _CD — Deploy to Staging_.

---

## 3. Production flow — deploy to PRODUCTION

Production deploys are tag-driven and gated behind a manual approval.

1. Complete the **pre-prod-deploy checklist** (section 5) first.
2. Tag the release on `main` and push the tag:
   ```bash
   git checkout main && git pull
   git tag -a v1.4.2 -m "Release v1.4.2"
   git push origin v1.4.2
   ```
3. `cd-production.yml` runs:
   - **build-and-push** — builds & pushes `ghcr.io/<owner>/<repo>/api:1.4.2`
     and `:latest`.
   - **deploy-production** — this job has `environment: production`, so it
     **pauses for a required reviewer to approve** in the Actions UI.
     After approval it SSHes to `PROD_HOST`, pulls the image, recreates the
     `api` service, and runs **smoke tests**:
     - `GET /health` → 200 with `services.database` and `services.redis` true
     - `GET /health/live` → 200
     - `GET /api/users/me` (no token) → 401
       If smoke tests fail (10 retries), it **auto-rolls back** and fails.
   - **notify** — posts to Slack.
4. Approve the deploy in _Actions → the run → Review deployments → production_.
5. Confirm the Slack success message and spot-check the app.

> Semver tags must match `v*.*.*`. A tag like `v1.4.2-rc1` will NOT trigger
> the production pipeline.

---

## 4. Rollback procedures

### 4a. Automatic (in-pipeline)

Both `cd-staging.yml` and `cd-production.yml` record the currently-running
image before deploying and automatically revert to it if the health/smoke
gate fails. No action needed — read the run logs and Slack to confirm.

### 4b. Manual via GitHub Actions (`rollback.yml`)

Use this when a bad deploy was already declared healthy but a problem surfaced
later.

1. _Actions → Rollback → Run workflow_.
2. Inputs:
   - **environment**: `staging` or `production`
   - **image_tag**: a full ref (`ghcr.io/<owner>/<repo>/api:v1.4.1`) **or** a
     bare tag (`v1.4.1` / `staging-<sha>`) which is expanded automatically.
3. The workflow SSHes to the chosen host, pulls + deploys that tag, verifies
   `/health`, and logs the rollback to Slack.

### 4c. Manual via SSH (`rollback.sh`)

Last resort / when GitHub is unavailable. SSH to the host and run the
host-side script (shipped in the image / deploy dir):

```bash
ssh <user>@<host>
cd /opt/chathouse/backend
# full ref:
./scripts/deploy/rollback.sh ghcr.io/<owner>/<repo>/api:v1.4.1
# OR bare tag (requires IMAGE_NAME for expansion):
IMAGE_NAME=<owner>/<repo>/api ./scripts/deploy/rollback.sh v1.4.1
```

`rollback.sh` pulls the image, recreates the `api` service, and runs
`health-check.sh`. It exits non-zero if the rolled-back image is unhealthy.

### 4d. Standalone health probe

```bash
BASE_URL=http://localhost:4000 ./scripts/deploy/health-check.sh
# or
./scripts/deploy/health-check.sh https://api.chathouse.app
```

Exit 0 = healthy, exit 1 = failed (after 10 retries with exponential backoff).

---

## 5. Pre-prod-deploy checklist

Run through this **before** pushing a `v*.*.*` tag:

- [ ] **CI is green** on the commit being tagged (lint, typecheck, tests,
      gitleaks).
- [ ] **DB migrations apply on boot** — the api image runs `prisma migrate deploy`
      at startup, so a fresh OR existing prod DB is migrated automatically from
      `prisma/migrations/` (the chain is complete as of the 2026-07 catch-up
      migration `20260711120000_sync_schema_drift`, which is idempotent). If the
      release ADDS a migration, confirm it applied cleanly in the deploy logs. Do
      NOT `db push` to prod — it bypasses migration history.
- [ ] **Database backup taken** — trigger / confirm a fresh pg dump
      (`docker/backup` stack: `docker compose -f docker-compose.yml -f
docker/backup/docker-compose.backup.yml ...`). Confirm the dump file
      exists and is non-empty.
- [ ] **Staging is healthy** on the same image lineage — smoke tests green on
      staging.
- [ ] **New env vars present** on the prod host's `.env` (see section 6.2).
      Missing required vars (e.g. `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`)
      will crash boot via the zod env validation.
- [ ] **On-call notified** — post in the ops channel that a prod deploy is
      starting; ensure an approver is available for the environment gate.
- [ ] **Rollback target known** — note the current prod tag so you can pass it
      to `rollback.yml` if needed.
- [ ] **Maintenance window** considered for breaking schema changes.

---

## 6. Configuration reference

### 6.1 Required GitHub Secrets

Set these in _Settings → Secrets and variables → Actions_ (and scope the
host/SSH secrets to the matching **Environment** where appropriate).

| Secret              | Used by                 | Purpose                                                     |
| ------------------- | ----------------------- | ----------------------------------------------------------- |
| `GITHUB_TOKEN`      | all (auto-provided)     | Pushes images to GHCR (`packages: write`). No manual setup. |
| `STAGING_HOST`      | cd-staging, rollback    | Staging host (IP/DNS) for SSH.                              |
| `STAGING_USER`      | cd-staging, rollback    | SSH user on the staging host.                               |
| `STAGING_SSH_KEY`   | cd-staging, rollback    | Private SSH key (PEM) for the staging user.                 |
| `PROD_HOST`         | cd-production, rollback | Production host for SSH.                                    |
| `PROD_USER`         | cd-production, rollback | SSH user on the production host.                            |
| `PROD_SSH_KEY`      | cd-production, rollback | Private SSH key (PEM) for the production user.              |
| `SLACK_WEBHOOK_URL` | all CD workflows        | Incoming-webhook URL for deploy notifications.              |

If the GHCR package is in a different org/visibility than the repo, you may
need a `GHCR_PAT` (classic PAT with `write:packages`) instead of
`GITHUB_TOKEN`; the workflows currently use `GITHUB_TOKEN`.

### 6.2 Application env (host `.env`, NOT GitHub secrets)

The API reads its config from the host's `.env` consumed by `docker-compose`.
Keep these on the host (or your secrets manager), not in the repo. Required /
notable:

| Var                           | Required | Notes                                                                                     |
| ----------------------------- | :------: | ----------------------------------------------------------------------------------------- |
| `DATABASE_URL`                |   yes    | Postgres DSN. In-compose default: `postgres:5432/chathouse`.                              |
| `REDIS_URL`                   |   yes    | e.g. `redis://redis:6379`.                                                                |
| `JWT_ACCESS_SECRET`           |   yes    | zod-validated; boot fails if missing.                                                     |
| `JWT_REFRESH_SECRET`          |   yes    | zod-validated; boot fails if missing.                                                     |
| `CORS_ORIGINS`                |   rec    | Comma-separated allowed origins.                                                          |
| `NODE_ENV`                    |   rec    | `production` on prod.                                                                     |
| `LIVEKIT_URL`                 |   yes    | Public `wss://` LiveKit endpoint (Cloud or self-hosted). Live audio 503s without it.      |
| `LIVEKIT_API_KEY`             |   yes    | LiveKit API key. Boot-guarded against the dev default in prod.                            |
| `LIVEKIT_API_SECRET`          |   yes    | LiveKit API secret. Boot-guarded against the dev default in prod.                         |
| `TWILIO_ACCOUNT_SID`          |   yes    | Twilio SMS — phone+OTP is the ONLY login path; prod compose fail-closes without it.       |
| `TWILIO_AUTH_TOKEN`           |   yes    | Twilio auth token.                                                                        |
| `TWILIO_FROM_NUMBER`          |   yes    | E.164 SMS sender number.                                                                  |
| `FIREBASE_SERVICE_ACCOUNT`    |   opt    | FCM service-account JSON (single line) for push send; needs `PUSH_DISPATCH_ENABLED=true`. |
| `MEDIASOUP_*`                 |   n/a    | Legacy SFU — audio is LiveKit; prod compose sets `MEDIASOUP_ENABLED=false`. Ignore.       |
| `ICE_SERVERS_JSON`            |   opt    | STUN/TURN for self-hosted LiveKit clients behind symmetric NAT.                           |
| `ACCOUNT_DELETION_GRACE_DAYS` |   opt    | GDPR hard-delete grace (default 30).                                                      |
| `AUDIT_LOG_RETENTION_DAYS`    |   opt    | Audit log retention (default 90).                                                         |
| `SENTRY_DSN`                  |   opt    | Enables error reporting (@sentry/node v8).                                                |

LiveKit Cloud is the lowest-ops choice — it provides global TURN and needs only
the three `LIVEKIT_*` values above (no self-host UDP ports / TURN sidecar).

### 6.3 GitHub Environments

The `staging` and `production` GitHub **Environments** gate the deploy jobs.
The desired config is documented in
`.github/environments/staging.yml` (and the production equivalent should be
created with **stricter required reviewers**). GitHub does **not** read those
YAML files automatically — configure them in _Settings → Environments_.

---

## 7. Troubleshooting

| Symptom                           | Likely cause / fix                                                                                                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy job auto-rolled back       | `/health` never returned 200+db+redis true. Check `docker compose logs api`.                                                                                                                                      |
| `/health` shows `database:false`  | DB unreachable / `DATABASE_URL` wrong / schema not pushed.                                                                                                                                                        |
| `/health` shows `redis:false`     | Redis down / `REDIS_URL` wrong.                                                                                                                                                                                   |
| Boot crash, no `/health` at all   | Missing required env (JWT secrets). Check container logs.                                                                                                                                                         |
| Live audio fails for remote users | `MEDIASOUP_ANNOUNCED_IP` is 127.0.0.1 or UDP ports not published.                                                                                                                                                 |
| GHCR push 403                     | `packages: write` permission / package visibility / token scope.                                                                                                                                                  |
| Prod job stuck "Waiting"          | Required-reviewer approval pending in the Environment gate.                                                                                                                                                       |
| `prisma migrate deploy` P3005     | A pre-existing DB has tables but no `_prisma_migrations` baseline. Baseline it: `prisma migrate resolve --applied 00000000000000_init` (repeat for later migrations), then re-deploy. Do NOT switch to `db push`. |
