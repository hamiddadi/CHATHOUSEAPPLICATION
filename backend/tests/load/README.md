# Load-test tools

Both load tools default to `http://127.0.0.1:4000` and refuse remote traffic
unless the target is explicitly authorized. Validate the complete contract in
CI without starting the backend or sending traffic:

```powershell
npm run load:check
```

## Functional flow

`npm run load:functional` creates synthetic users and exercises REST and
Socket.IO flows. Useful settings are:

| Variable                       | Default | Allowed                  |
| ------------------------------ | ------: | ------------------------ |
| `LOAD_TEST_USERS`              |    `50` | `2..200`                 |
| `LOAD_TEST_CONCURRENCY`        |    `10` | `1..50`, not above users |
| `LOAD_TEST_REQUEST_TIMEOUT_MS` |  `5000` | `1000..30000`            |
| `LOAD_TEST_HTTP_RETRIES`       |     `2` | `0..5`                   |
| `LOAD_TEST_MAX_FAILURE_RATE`   |     `0` | `0..<1`                  |
| `LOAD_TEST_RESET_RATE_LIMITS`  | `false` | strict boolean           |

Rate-limit resets are disabled by default. Enabling them uses a bounded Redis
`SCAN` and is accepted only for a loopback Redis URL; remote Redis mutation is
always rejected. Prefer increasing the test backend's rate-limit setting.

## k6 smoke flow

With the k6 CLI installed:

```powershell
npm run load:k6
```

Configure `LOAD_TEST_VUS`, `LOAD_TEST_DURATION`, `LOAD_TEST_P95_MS`,
`LOAD_TEST_MAX_HTTP_FAILURE_RATE`, and `LOAD_TEST_MAX_CHECK_FAILURE_RATE` as
needed. Setup checks `/health` before registering its synthetic user, all HTTP
calls have timeouts, and error thresholds abort sustained bad runs.

## Remote-target gates

A non-loopback target must use HTTPS and requires both:

```text
LOAD_TEST_ALLOW_REMOTE=true
LOAD_TEST_CONFIRM_TARGET=https://staging.example.net
```

The confirmation must exactly match the normalized target origin. Known
ChatHouse production domains additionally require
`LOAD_TEST_ALLOW_PRODUCTION=true`. Do not set that variable in CI or shared
shell profiles. Load runs create data, so use an isolated staging database and
explicitly clean synthetic `load_*` / `lt_*` accounts after an authorized run.
