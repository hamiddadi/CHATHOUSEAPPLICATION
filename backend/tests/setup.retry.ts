// Runs in setupFilesAfterEnv (the test framework — and the `jest` global with
// retryTimes — only exists here, not in setupFiles).
//
// The integration suites hit real Postgres + Redis and boot a Socket.IO server
// with many client sockets per test. Running all 42 files back-to-back in one
// `--runInBand` process steadily accumulates TIME_WAIT sockets and load, so an
// occasional `connect ENOBUFS` (ephemeral-port/socket-buffer exhaustion) or a
// 6s `waitFor` timeout is transient infra noise — every such test passes when
// its file runs on its own. Retry twice to absorb that noise; a genuine logic
// failure still fails on every attempt and is reported. Unit suites are
// deterministic, so retries never trigger for them.
jest.retryTimes(2, { logErrorsBeforeRetry: true });
