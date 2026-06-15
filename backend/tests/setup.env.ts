// Populate env before any source module loads. Integration tests hit the
// running docker-compose stack (port 5433 on host because Postgres.exe owns
// 5432 on Windows); unit tests never touch these URLs.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ?? 'test-access-secret-that-is-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-that-is-at-least-32-characters-long';
process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? 'http://localhost:8081';
// authLimiter is in-memory and shared across suites. Bump the cap so the
// dedicated rate-limit test (which burns ~30 attempts) can't starve downstream
// suites that register/login via the same bucket. The rate-limit test still
// proves the mechanism works — only the threshold is raised for the test run.
process.env.AUTH_RATE_LIMIT_MAX = process.env.AUTH_RATE_LIMIT_MAX ?? '1000';
// Same reasoning for the blanket /api global limiter: it's an in-memory bucket
// (MemoryStore in test) that counts EVERY request, and a request-heavy suite
// (e.g. roomModeration, which registers dozens of users) would trip the default
// cap of 100 partway through. Bump it so request volume never causes 429s; the
// dedicated rate-limit test sets its own threshold and still proves the gate.
process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX ?? '100000';
