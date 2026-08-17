const INTEGRATION_TEST_BASENAME =
  /^(?:seed-(?:api|socket)|.+\.(?:integration|workflow))\.test\.ts$/u;

/**
 * Integration retries are intentionally opt-in by filename. Keeping the
 * classifier here makes it testable and prevents a newly added unit suite
 * from silently inheriting retries.
 */
export const isIntegrationTestPath = (testPath: string): boolean => {
  const basename = testPath.split(/[\\/]/u).at(-1);
  return basename !== undefined && INTEGRATION_TEST_BASENAME.test(basename);
};
