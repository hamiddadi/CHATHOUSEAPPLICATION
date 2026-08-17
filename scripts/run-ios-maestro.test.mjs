import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('scripts/run-ios-maestro.sh', 'utf8');
const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const iosSmokeStep = workflow.slice(
  workflow.indexOf('      - name: Run smoke flow on iOS Simulator'),
  workflow.indexOf('      - name: Upload iOS E2E diagnostics'),
);

test('iOS Maestro retry is limited to failures before any flow starts', () => {
  assert.match(source, /run_maestro_attempt 1/u);
  assert.match(source, /if flow_started 1; then[\s\S]*exit "\$status"/u);
  assert.match(source, /run_maestro_attempt 2/u);
  assert.doesNotMatch(source, /run_maestro_attempt 3/u);
  assert.match(source, /-name commands\.json -o -name manifest\.json/u);
  assert.match(source, /report-attempt-\$attempt\.xml/u);
});

test('the CI workflow delegates the iOS smoke run to the checked shell harness', () => {
  assert.match(iosSmokeStep, /run: bash scripts\/run-ios-maestro\.sh/u);
  assert.doesNotMatch(iosSmokeStep, /\.maestro\/bin\/maestro/u);
});

test(
  'the iOS Maestro harness has valid Bash syntax',
  { skip: process.platform === 'win32' },
  () => {
    const result = spawnSync('bash', ['-n', 'scripts/run-ios-maestro.sh'], {
      encoding: 'utf8',
      shell: false,
    });

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  },
);
