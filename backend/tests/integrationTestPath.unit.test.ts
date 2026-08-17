import { isIntegrationTestPath } from './integrationTestPath';

describe('isIntegrationTestPath', () => {
  it.each([
    '/repo/backend/tests/auth.integration.test.ts',
    String.raw`C:\repo\backend\tests\socket.integration.test.ts`,
    '/repo/backend/tests/workflows/auth-session.workflow.test.ts',
    '/repo/backend/tests/seed-api.test.ts',
    '/repo/backend/tests/seed-socket.test.ts',
  ])('classifies integration suite %s', testPath => {
    expect(isIntegrationTestPath(testPath)).toBe(true);
  });

  it.each([
    '/repo/backend/tests/jwt.test.ts',
    '/repo/backend/tests/securityHardening.unit.test.ts',
    String.raw`C:\repo\backend\tests\roomFeed.unit.test.ts`,
    '/repo/backend/tests/integrationTestPath.unit.test.ts',
  ])('does not classify unit suite %s', testPath => {
    expect(isIntegrationTestPath(testPath)).toBe(false);
  });
});
