/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  // Seed-dependent smoke suites require a pre-seeded DB (fixed fixture users
  // from `npm run seed`) and throw "Run seed first" otherwise. Excluded from the
  // default run so `npm test` stays green on a non-seeded DB; run them via
  // `npm run test:seeded`, which seeds first (it clears the ignore via the CLI).
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/tests/seed-api.test.ts',
    '<rootDir>/tests/seed-socket.test.ts',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // firebase-admin v14 exposes /messaging only via the package `exports` map;
    // pin it to the on-disk entry so jest's resolver finds it (see tsconfig).
    '^firebase-admin/messaging$': '<rootDir>/node_modules/firebase-admin/lib/messaging',
  },
  setupFiles: ['<rootDir>/tests/setup.env.ts'],
  // Retry transient integration-infra failures (socket ENOBUFS / waitFor
  // timeouts that only surface in the long back-to-back --runInBand sweep, never
  // when a file runs in isolation). See tests/setup.retry.ts.
  setupFilesAfterEnv: ['<rootDir>/tests/setup.retry.ts'],
  // Integration suites hit a real Postgres + Redis and run several bcrypt
  // hashes / socket round-trips per test. The 5s Jest default is too tight when
  // the host is under load (CI, parallel builds) and produces spurious hook/test
  // timeouts (twoPointComm afterAll, passwordReset). 30s applies to tests AND
  // before/after hooks, giving ~6x headroom without masking a real hang.
  testTimeout: 30000,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/app.ts'],
  coverageDirectory: 'coverage',
  clearMocks: true,
};
