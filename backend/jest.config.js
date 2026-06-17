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
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/app.ts'],
  coverageDirectory: 'coverage',
  clearMocks: true,
};
