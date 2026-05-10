/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFiles: ['<rootDir>/tests/setup.env.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/app.ts'],
  coverageDirectory: 'coverage',
  clearMocks: true,
};
