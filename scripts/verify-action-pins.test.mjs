import assert from 'node:assert/strict';
import test from 'node:test';
import { findMutableActionReferencesInSource } from './verify-action-pins.mjs';

test('accepts full SHAs and local reusable workflows with common YAML quoting', () => {
  const source = `
steps:
  - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567
  - uses: "owner/action@abcdef0123456789abcdef0123456789abcdef01"
  - "uses": './.github/actions/local'
`;

  assert.deepEqual(findMutableActionReferencesInSource(source, 'valid.yml'), []);
});

test('rejects every mutable or malformed external reference', () => {
  const source = `
steps:
  - uses: actions/checkout@v5
  - uses: 'owner/action@main'
  - uses: "owner/action@latest"
  - uses: owner/action@ABCDEF0123456789ABCDEF0123456789ABCDEF01
  - uses: owner/action@abcdef0
`;

  assert.deepEqual(
    findMutableActionReferencesInSource(source, 'invalid.yml').map(item => item.target),
    [
      'actions/checkout@v5',
      'owner/action@main',
      'owner/action@latest',
      'owner/action@ABCDEF0123456789ABCDEF0123456789ABCDEF01',
      'owner/action@abcdef0',
    ],
  );
});
