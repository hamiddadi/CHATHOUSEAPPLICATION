// Populate env before any source module loads. Integration tests use the
// disposable docker-compose.test.yml stack; unit tests never touch these URLs.
process.env.NODE_ENV = 'test';
const testDatabaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5434/chathouse_test?schema=public';
process.env.DATABASE_URL = testDatabaseUrl;
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';

// A test suite truncates and rewrites tables. Refuse to start unless the DB
// name is explicitly test-scoped, preventing an accidental wipe of the normal
// development database when DATABASE_URL leaks in from backend/.env or a shell.
const databaseName =
  decodeURIComponent(new URL(testDatabaseUrl).pathname).replace(/^\/+/, '').split('/')[0] ?? '';
if (!/(^|[_-])test($|[_-])/i.test(databaseName)) {
  throw new Error(
    `[tests] Refusing unsafe DATABASE_URL: database "${databaseName}" is not test-scoped. ` +
      'Use a database name containing "test" (the default is chathouse_test).',
  );
}
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ?? 'test-access-secret-that-is-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-that-is-at-least-32-characters-long';
process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? 'http://localhost:8081';
// authLimiter is in-memory and shared across suites. Bump the process-wide cap
// so request-heavy integration suites cannot starve one another. The dedicated
// rate-limit test creates its own limiter + MemoryStore with a small threshold,
// so the production response contract is still exercised without shared state.
process.env.AUTH_RATE_LIMIT_MAX = process.env.AUTH_RATE_LIMIT_MAX ?? '1000';
// Same reasoning for the blanket /api global limiter: it's an in-memory bucket
// (MemoryStore in test) that counts EVERY request, and a request-heavy suite
// (e.g. roomModeration, which registers dozens of users) would trip the default
// cap of 100 partway through. Bump it so request volume never causes 429s; the
// dedicated rate-limit test uses an isolated threshold and still proves the gate.
process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX ?? '100000';
// Force-disable the dev/QA OTP test-number bypass so the suite never inherits
// it from a developer's backend/.env (which dotenv would otherwise load). Tests
// exercise the real send→verify path; the bypass is a manual-testing affordance.
process.env.OTP_TEST_NUMBERS = '';
process.env.LEGAL_DOCUMENT_VERSION = process.env.LEGAL_DOCUMENT_VERSION ?? '2026-07-29';
process.env.LEGAL_DOCUMENT_EFFECTIVE_DATE =
  process.env.LEGAL_DOCUMENT_EFFECTIVE_DATE ?? '2026-07-29';
