# ChatHouse — Deployment Runbook

Operational guide for shipping the ChatHouse **backend API** (Express 5 /
Prisma / mediasoup) to staging and production via GitHub Actions CD.

The API container is built from `backend/Dockerfile` (multi-stage
`node:22.23.1-slim`, runs `node dist/app.js` under `tini`, `EXPOSE 4000`) and runs
as the `api` service in the host's `docker-compose.prod.yml` alongside `postgres`
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
- Production tag: `<semver>` (e.g. `1.4.2`), created only after the protected
  production deployment succeeds. The release workflow does not publish or
  move `latest`.

These tags are discovery aliases only. Every deploy, rollback and migration
upgrade drill uses the immutable identity
`ghcr.io/<owner>/<repo>/api@sha256:<64 lowercase hex characters>`.

---

## 2. Normal flow — deploy to STAGING

Staging deploys are automatic.

1. Merge a PR (or push) to `main`.
2. `cd-staging.yml` runs:
   - **build-and-push** — builds `./backend` and pushes
     `ghcr.io/<owner>/<repo>/api:staging-<sha>` (+ `staging-latest`), captures
     the registry-produced digest and passes only that digest to deployment.
   - **deploy-staging** — uploads a reviewed infrastructure archive containing
     only versioned Compose/config/scripts, preserves the previous Compose,
     then activates the new image. Host `.env`, external secret files, media,
     and Docker volumes are never included or overwritten.
   - The deploy script validates Compose, verifies the exact running image and
     polls all health endpoints with bounded request timeouts. A Compose error,
     image mismatch, or failed smoke gate **auto-rolls back** with the preserved
     Compose and must prove the previous image healthy before the job exits.
   - **attest-staging-candidate** — only after a successful staging deployment,
     uploads GitHub Actions evidence binding the repository, source commit,
     workflow run and exact accepted image digest. Production accepts evidence
     only from a successful push-to-`main` run for the tagged commit.
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
   - **resolve-candidate** — does not rebuild. It finds a successful staging
     push run for the exact tagged commit, downloads that run's acceptance
     evidence, validates its repository/SHA/run identity and confirms the
     immutable digest still exists in GHCR.
   - **deploy-production** — this job has `environment: production`, so it
     **pauses for a required reviewer to approve** in the Actions UI.
     After approval it SSHes to `PROD_HOST`, pulls that exact staging-tested
     digest, recreates the `api` service, and runs **smoke tests**:
     - `GET /health` → 200 with `services.database` and `services.redis` true
     - `GET /health/live` → 200
     - `GET /api/users/me` (no token) → 401
       If smoke tests fail (10 retries), it **auto-rolls back** and fails.
   - **promote-release** — only after the protected deploy succeeds, points the
     SemVer discovery tag at the accepted digest. No `latest` tag is moved.
   - **notify** — posts to Slack.
4. Approve the deploy in _Actions → the run → Review deployments → production_.
5. Confirm the Slack success message and spot-check the app.

> The GitHub trigger is necessarily broad, but the candidate-resolution job enforces
> exactly `vMAJOR.MINOR.PATCH` with no leading zeros, prerelease or build
> metadata. For example, `v1.4.2-rc.1`, `v01.4.2` and `release-1.4.2` fail.
> A correctly formed tag also fails closed unless its commit has successful,
> matching staging acceptance evidence. No production alias is published
> before the environment approval and successful deployment.

---

## 4. Rollback procedures

### 4a. Automatic (in-pipeline)

Both `cd-staging.yml` and `cd-production.yml` record the currently-running
image digest and Compose definition before deploying. If pull, Compose, image
identity, or health/smoke fails, they restore the previous digest and atomically
restore the previous on-disk Compose definition. No action needed — read the
run logs and Slack to confirm both restorations.

### 4b. Manual via GitHub Actions (`rollback.yml`)

Use this when a bad deploy was already declared healthy but a problem surfaced
later.

1. _Actions → Rollback → Run workflow_.
2. Inputs:
   - **environment**: `staging` or `production`
   - **image_digest**: the exact full ref
     `ghcr.io/<owner>/<repo>/api@sha256:<64 lowercase hex characters>`.
     Tags, other registries and other repositories are rejected.
3. The workflow SSHes to the chosen host, pulls + deploys that digest, verifies
   `/health`, and logs the rollback to Slack.

### 4c. Manual via SSH (`rollback.sh`)

Last resort / when GitHub is unavailable. SSH to the host and run the
host-side script (shipped in the image / deploy dir):

```bash
ssh <user>@<host>
cd /opt/chathouse/backend
# Full ref (IMAGE_NAME is still required to restrict the repository):
IMAGE_NAME=<owner>/<repo>/api ./scripts/deploy/rollback.sh \
  ghcr.io/<owner>/<repo>/api@sha256:<64-lowercase-hex-characters>
# Or the bare digest, resolved only inside the configured repository:
IMAGE_NAME=<owner>/<repo>/api ./scripts/deploy/rollback.sh \
  sha256:<64-lowercase-hex-characters>
```

`rollback.sh` accepts only immutable digests from the configured repository. If
the requested rollback target fails Compose, image verification, or health
checks, it restores and verifies the digest that was running before the command.

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
- [ ] **DB migration upgrade drill passes on a production clone** — fresh-DB CI
      is necessary but insufficient. Restore the latest sanitized production
      snapshot into an isolated disposable DB, then run the candidate image's
      `scripts/deploy/validate-migration-upgrade.sh` procedure from section 6.5.
      The initial `migrate status` is informational and may exit non-zero when
      migrations are pending; `migrate deploy` and the final status must pass.
      Never aim this drill at production and never use `db push`.
- [ ] **Database backup taken** — trigger / confirm a fresh pg dump
      with the production Compose pair from section 6.6. Confirm gzip integrity,
      offsite upload and a clean temporary restore drill against the exact
      candidate digest all pass.
- [ ] **Staging is healthy on the exact candidate digest** — record evidence
      that the production candidate
      `repository@sha256:<64 lowercase hex characters>` was exercised and its
      smoke tests passed on staging. The staging workflow now records this
      digest-bound evidence automatically after a successful push-to-`main`
      deployment, and production refuses to rebuild or deploy any other digest.
- [ ] **New env vars present** on the prod host's `.env` (see section 6.2).
      Missing required vars (e.g. `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`)
      will crash boot via the zod env validation.
- [ ] **FCM delivery is proven** — `PUSH_DISPATCH_ENABLED=true` and exactly one
      Firebase credential mode is configured. Confirm a push reaches one
      physical Android device and one physical iOS device from this environment;
      a successful API boot now mints a real OAuth token with a 10-second
      fail-closed timeout, but does not validate APNs/FCM routing end to end.
- [ ] **Metrics secret exists and is shared** — the file referenced by
      `METRICS_TOKEN_SECRET_FILE` contains at least 32 random bytes. Keep its
      parent directory mode `0700` and the file mode `0444`: file-backed
      Compose secrets preserve host permissions, and the API runs as the
      non-root `node` user. Only the API and Prometheus mount this file; the
      token itself must not be copied into `.env`.
- [ ] **Monitoring access is private** — set a strong
      `GF_SECURITY_ADMIN_PASSWORD`. Prometheus, Grafana and Alertmanager bind
      only to `127.0.0.1`; use an SSH tunnel or an authenticated TLS proxy for
      operator access. Node Exporter has no host-published port.
- [ ] **Alert delivery is proven** — create the Slack and SMTP password files,
      set all `SMTP_*`/`ALERT_EMAIL_TO` routing values, start the renderer and
      Alertmanager, then fire a controlled warning and critical test alert.
- [ ] **On-call notified** — post in the ops channel that a prod deploy is
      starting; ensure an approver is available for the environment gate.
- [ ] **Rollback target known** — note the current pullable production digest
      so you can pass its exact full reference to `rollback.yml` if needed.
- [ ] **Migration is backward-compatible** — use expand/contract migrations:
      the previous application image must continue working after
      `prisma migrate deploy`. Do not drop/rename columns or tighten constraints
      in the same release that stops reading the old shape. Database rollback
      is not automatic; verify the latest encrypted backup/restore drill before
      any destructive follow-up release.

---

## 6. Configuration reference

### 6.1 Required GitHub Secrets

Set these in _Settings → Secrets and variables → Actions_ (and scope the
host/SSH secrets to the matching **Environment** where appropriate).

| Secret                     | Used by                 | Purpose                                                     |
| -------------------------- | ----------------------- | ----------------------------------------------------------- |
| `GITHUB_TOKEN`             | all (auto-provided)     | Pushes images to GHCR (`packages: write`). No manual setup. |
| `STAGING_HOST`             | cd-staging, rollback    | Staging host (IP/DNS) for SSH.                              |
| `STAGING_USER`             | cd-staging, rollback    | SSH user on the staging host.                               |
| `STAGING_SSH_KEY`          | cd-staging, rollback    | Private SSH key (PEM) for the staging user.                 |
| `STAGING_HOST_FINGERPRINT` | cd-staging, rollback    | Pinned SSH host-key fingerprint (for example SHA256:...).   |
| `PROD_HOST`                | cd-production, rollback | Production host for SSH.                                    |
| `PROD_USER`                | cd-production, rollback | SSH user on the production host.                            |
| `PROD_SSH_KEY`             | cd-production, rollback | Private SSH key (PEM) for the production user.              |
| `PROD_HOST_FINGERPRINT`    | cd-production, rollback | Pinned production SSH host-key fingerprint.                 |
| `SLACK_WEBHOOK_URL`        | all CD workflows        | Incoming-webhook URL for deploy notifications.              |

If the GHCR package is in a different org/visibility than the repo, you may
need a `GHCR_PAT` (classic PAT with `write:packages`) instead of
`GITHUB_TOKEN`; the workflows currently use `GITHUB_TOKEN`.

Obtain each host fingerprint over a separately trusted channel (cloud console,
configuration management or an existing verified session), not from the first
unverified CI connection. Rotating a host key requires reviewing and updating
the corresponding secret before CD can reconnect.

### 6.2 Application env (host `.env`, NOT GitHub secrets)

The API reads its config from the host's `.env` consumed by `docker-compose`.
Keep these on the host (or your secrets manager), not in the repo. Required /
notable:

| Var                                      | Required | Notes                                                                                                  |
| ---------------------------------------- | :------: | ------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                           |   yes    | Postgres DSN. In-compose default: `postgres:5432/chathouse`.                                           |
| `REDIS_URL`                              |   yes    | e.g. `redis://redis:6379`.                                                                             |
| `JWT_ACCESS_SECRET`                      |   yes    | zod-validated; boot fails if missing.                                                                  |
| `JWT_REFRESH_SECRET`                     |   yes    | zod-validated; boot fails if missing.                                                                  |
| `CORS_ORIGINS`                           |   rec    | Comma-separated allowed origins.                                                                       |
| `NODE_ENV`                               |   rec    | `production` on prod.                                                                                  |
| `LIVEKIT_URL`                            |   yes    | Public `wss://` LiveKit endpoint (Cloud or self-hosted). Live audio 503s without it.                   |
| `LIVEKIT_INTERNAL_URL`                   |   cond   | Server-to-server HTTP URL; required for self-host (`http://livekit:7880`), Cloud falls back to public. |
| `LIVEKIT_API_KEY`                        |   yes    | LiveKit API key. Boot-guarded against the dev default in prod.                                         |
| `LIVEKIT_API_SECRET`                     |   yes    | LiveKit API secret. Boot-guarded against the dev default in prod.                                      |
| `LIVEKIT_TOKEN_TTL_SECONDS`              |   opt    | LiveKit join-token TTL; defaults to and is operationally capped at 300 seconds.                        |
| `TWILIO_ACCOUNT_SID`                     |   yes    | Twilio SMS — phone+OTP is the ONLY login path; prod compose fail-closes without it.                    |
| `TWILIO_AUTH_TOKEN`                      |   yes    | Twilio auth token.                                                                                     |
| `TWILIO_FROM_NUMBER`                     |   yes    | E.164 SMS sender number.                                                                               |
| `PUSH_DISPATCH_ENABLED`                  |   yes    | Must be `true` in production; the API refuses to boot otherwise.                                       |
| `FIREBASE_SERVICE_ACCOUNT`               | choice A | Complete FCM service-account JSON on one line; mutually exclusive with ADC.                            |
| `FIREBASE_USE_ADC`                       | choice B | Set `true` to explicitly use workload/instance Application Default Credentials.                        |
| `GOOGLE_APPLICATION_CREDENTIALS`         |   opt    | ADC file path inside the container; not needed for workload identity/instance metadata.                |
| `MEDIASOUP_*`                            |   n/a    | Legacy SFU — audio is LiveKit; prod compose sets `MEDIASOUP_ENABLED=false`. Ignore.                    |
| `ICE_SERVERS_JSON`                       |   opt    | STUN/TURN for self-hosted LiveKit clients behind symmetric NAT.                                        |
| `ACCOUNT_DELETION_GRACE_DAYS`            |   opt    | GDPR hard-delete grace (default 30).                                                                   |
| `AUDIT_LOG_RETENTION_DAYS`               |   opt    | Audit log retention (default 90).                                                                      |
| `SENTRY_DSN`                             |   opt    | Enables error reporting (@sentry/node v8).                                                             |
| `METRICS_TOKEN_SECRET_FILE`              |   yes    | Absolute host path to the shared API/Prometheus Bearer-token file.                                     |
| `GF_SECURITY_ADMIN_PASSWORD`             |  yes\*   | Required when starting the separate Grafana monitoring stack; no default is accepted.                  |
| `CHATHOUSE_API_IMAGE`                    |   yes    | Initial `repository@sha256` digest; CD overrides it with a verified digest.                            |
| `SMTP_SMARTHOST` / `SMTP_FROM`           |  yes\*   | Non-secret SMTP routing rendered before Alertmanager starts.                                           |
| `SMTP_USERNAME` / `ALERT_EMAIL_TO`       |  yes\*   | Non-secret Alertmanager mail routing.                                                                  |
| `ALERTMANAGER_SLACK_WEBHOOK_SECRET_FILE` |  yes\*   | Absolute host path to the Slack webhook secret file.                                                   |
| `ALERTMANAGER_SMTP_PASSWORD_SECRET_FILE` |  yes\*   | Absolute host path to the SMTP password secret file.                                                   |

LiveKit Cloud is the lowest-ops choice — it provides global TURN and needs only
the three required `LIVEKIT_*` values above; `LIVEKIT_INTERNAL_URL` may stay
empty and falls back to the public host (no self-host UDP ports / TURN sidecar).

### 6.3 First host bootstrap

The CD archive deliberately contains no `.env` or secret. Before the first
deployment, place a reviewed copy of the versioned `backend/` infrastructure in
`/opt/chathouse/backend`, then create `/opt/chathouse/backend/.env` from
`.env.prod.example`. Replace every placeholder, including an already-published
stable image:

```dotenv
CHATHOUSE_API_IMAGE=ghcr.io/<owner>/<repo>/api@sha256:<64-lowercase-hex-characters>
```

The file must also contain every `${VAR:?required}` value referenced by
`docker-compose.prod.yml`: Postgres/Redis credentials, JWT, CORS/public URL,
private media storage, LiveKit, Twilio, Resend, Firebase, Stripe, metrics secret
path and the Alertmanager values documented below. The `LEGAL_*` and public
contact values must come from the reviewed
`docs/legal/RELEASE-INFORMATION-REQUIRED.md` sheet; the version and effective
date must exactly match `docs/legal/document-control.json`, whose status must be
`published`. The API and go-live preflight reject unresolved or divergent legal
values. Then validate and start the
complete initial stack. Complete the secret-file setup in section 6.4 before
running these commands:

```bash
cd /opt/chathouse/backend
chmod 0600 .env
docker login ghcr.io
docker compose --env-file .env -f docker-compose.prod.yml config --quiet
docker compose --env-file .env -f docker-compose.prod.yml pull
docker compose --env-file .env -f docker-compose.prod.yml up -d
BASE_URL=http://localhost:4000 ./scripts/deploy/health-check.sh
```

After this bootstrap, CD synchronizes only its explicit versioned allowlist and
activates immutable API images. It never copies `.env`, `/opt/chathouse/secrets`,
media, named volumes or database files.

### 6.4 Metrics and Alertmanager secrets

Create the secret once on the production host as the same account that runs
Compose. Keep the file outside the checkout and do not print the generated
token:

```bash
install -d -m 0700 /opt/chathouse/secrets
umask 077
token="$(openssl rand -hex 32)"
printf '%s' "$token" > /opt/chathouse/secrets/metrics_token
unset token
chmod 0444 /opt/chathouse/secrets/metrics_token
```

Create the Alertmanager files in the same protected directory. Capture their
values without command-line arguments or shell history:

```bash
umask 077
read -r -s -p "Slack webhook: " slack_webhook
printf '\n'
printf '%s' "$slack_webhook" > /opt/chathouse/secrets/alertmanager_slack_webhook
unset slack_webhook
read -r -s -p "SMTP password: " smtp_password
printf '\n'
printf '%s' "$smtp_password" > /opt/chathouse/secrets/alertmanager_smtp_password
unset smtp_password
chmod 0444 /opt/chathouse/secrets/alertmanager_*
```

The parent directory remains accessible only to the deployment account on the
host. The secret file itself is read-only so the non-root API container can
read the bind-mounted Compose secret. Each service mounts only the credentials
it needs.

Set only absolute secret paths and non-secret routing in `.env`:

```dotenv
METRICS_TOKEN_SECRET_FILE=/opt/chathouse/secrets/metrics_token
ALERTMANAGER_SLACK_WEBHOOK_SECRET_FILE=/opt/chathouse/secrets/alertmanager_slack_webhook
ALERTMANAGER_SMTP_PASSWORD_SECRET_FILE=/opt/chathouse/secrets/alertmanager_smtp_password
SMTP_SMARTHOST=smtp.example.com:587
SMTP_FROM=alerts@chathouse.app
SMTP_USERNAME=alerts@chathouse.app
ALERT_EMAIL_TO=oncall@chathouse.app
```

Start the API first, then the separate monitoring project with the same env
file:

```bash
cd /opt/chathouse/backend
docker compose --env-file .env -f docker-compose.prod.yml up -d
cd docker/monitoring
docker compose --env-file ../../.env -f docker-compose.monitoring.yml up -d
docker compose --env-file ../../.env -f docker-compose.monitoring.yml ps
```

Prometheus reads the file via `authorization.credentials_file` and sends
`Authorization: Bearer ...` on every `/metrics` scrape. The API reads the same
Compose secret at startup. After rotating the file, recreate both `api` and
`prometheus` so they converge on the new value. The monitoring web interfaces
bind to loopback only. For example, reach Grafana without exposing it publicly:

```bash
ssh -L 3001:127.0.0.1:3001 <user>@<host>
```

The one-shot `alertmanager-config-renderer` substitutes only SMTP routing and
recipient values. It writes to a private named volume; webhook and SMTP
password remain file-backed secrets read directly by Alertmanager. CI runs
`amtool check-config`, `promtool check config`, and `promtool check rules`.

### 6.5 Production-clone migration upgrade drill

Restore the newest sanitized production snapshot into an isolated disposable
Postgres instance/network. Put only that clone's `DATABASE_URL` in a mode-0600
file; never reuse or copy the production DSN:

```bash
chmod 0600 /secure/chathouse-migration-clone.env
cd /opt/chathouse/backend
MIGRATION_CLONE_ENV_FILE=/secure/chathouse-migration-clone.env \
MIGRATION_CLONE_DOCKER_NETWORK=backend_default \
MIGRATION_CLONE_CONFIRMED=disposable-clone \
./scripts/deploy/validate-migration-upgrade.sh \
  ghcr.io/<owner>/<repo>/api@sha256:<64-lowercase-hex-characters>
```

The script rejects every tag and malformed/uppercase digest. It checks the
initial migration status for information (a non-zero result is expected when
migrations are pending), applies the candidate image's migration chain, then
requires a clean final status. Destroy the clone after reviewing the output.
This is a required release gate whenever migrations change; it does not
replace the fresh-database CI test.

### 6.6 Production backup and clean restore drill

Always combine the backup override with the production Compose file. The dev
Compose has different credentials and must never be used for production
backup/restore:

```bash
cd /opt/chathouse/backend
docker compose --env-file .env \
  -f docker-compose.prod.yml \
  -f docker/backup/docker-compose.backup.yml \
  run --rm backup pg_backup.sh

# Default RESTORE_MODE=verify: pull the exact candidate digest with the host's
# authenticated Docker client, then restore into a clean temporary DB. The
# socket is mounted only into this ad-hoc trusted restore container.
candidate='ghcr.io/<owner>/<repo>/api@sha256:<64-lowercase-hex-characters>'
docker pull "$candidate"
RESTORE_CANDIDATE_IMAGE="$candidate" \
RESTORE_CANDIDATE_DOCKER_NETWORK=backend_default \
  docker compose --env-file .env \
  -f docker-compose.prod.yml \
  -f docker/backup/docker-compose.backup.yml \
  run --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    backup pg_restore.sh
```

The restore fails closed if the backup contains an unfinished, non-rolled-back
Prisma migration. It then runs `prisma migrate deploy` and
`prisma migrate status` from the exact candidate digest against the temporary
database, and rechecks the migration table before declaring success. Tags and
malformed digests are rejected. The temporary database is dropped on both
success and failure.

An actual replacement is an incident procedure, not a routine drill. Stop the
API, set `RESTORE_MODE=replace` and `RESTORE_ALLOW_REPLACE=true` only for that
command, then type the exact database name. The script first validates a clean
temporary restore, renames the current DB aside with connections disabled and
promotes the restored DB. It retains the prior database until operators verify
the application and take a new backup; cleanup is intentionally manual.

```bash
docker compose --env-file .env -f docker-compose.prod.yml stop api
candidate='ghcr.io/<owner>/<repo>/api@sha256:<64-lowercase-hex-characters>'
docker pull "$candidate"
RESTORE_MODE=replace \
RESTORE_ALLOW_REPLACE=true \
RESTORE_CANDIDATE_IMAGE="$candidate" \
RESTORE_CANDIDATE_DOCKER_NETWORK=backend_default \
  docker compose --env-file .env \
    -f docker-compose.prod.yml \
    -f docker/backup/docker-compose.backup.yml \
    run --rm \
      -v /var/run/docker.sock:/var/run/docker.sock \
      backup pg_restore.sh
docker compose --env-file .env -f docker-compose.prod.yml start api
BASE_URL=http://localhost:4000 ./scripts/deploy/health-check.sh
```

### 6.7 GitHub Environments

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
| Boot crash, no `/health` at all   | Missing required env (JWT/delivery secrets) or invalid Firebase initialization. Check container logs.                                                                                                             |
| Live audio fails for remote users | `MEDIASOUP_ANNOUNCED_IP` is 127.0.0.1 or UDP ports not published.                                                                                                                                                 |
| GHCR push 403                     | `packages: write` permission / package visibility / token scope.                                                                                                                                                  |
| Prod job stuck "Waiting"          | Required-reviewer approval pending in the Environment gate.                                                                                                                                                       |
| `prisma migrate deploy` P3005     | A pre-existing DB has tables but no `_prisma_migrations` baseline. Baseline it: `prisma migrate resolve --applied 00000000000000_init` (repeat for later migrations), then re-deploy. Do NOT switch to `db push`. |
