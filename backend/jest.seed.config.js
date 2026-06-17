const base = require('./jest.config');

/**
 * Dedicated config for the seed-dependent smoke suites (seed-api / seed-socket).
 * They require the fixture users created by `npm run seed`, so the default
 * `npm test` excludes them. `npm run test:seeded` seeds first, then runs them
 * via this config — which matches ONLY those two files and drops the seed
 * exclusion the base config applies.
 */
/** @type {import('jest').Config} */
module.exports = {
  ...base,
  testMatch: ['**/seed-api.test.ts', '**/seed-socket.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
};
