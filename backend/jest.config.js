/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
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
