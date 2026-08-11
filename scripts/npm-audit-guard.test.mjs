import assert from 'node:assert/strict';
import test from 'node:test';
import { hashSecurityPatch, resolveBlockingAdvisories } from './npm-audit-guard.mjs';

const advisory = url => ({ severity: 'high', url });

test('resolves a cyclic transitive graph to its real advisory', () => {
  const report = {
    vulnerabilities: {
      app: { severity: 'high', via: ['metro'] },
      metro: { severity: 'high', via: ['image-size', 'metro-config'] },
      'metro-config': { severity: 'high', via: ['metro'] },
      'image-size': {
        severity: 'high',
        via: [advisory('https://github.com/advisories/GHSA-example')],
      },
    },
  };

  assert.deepEqual(resolveBlockingAdvisories(report), [
    'https://github.com/advisories/GHSA-example',
  ]);
});

test('surfaces a newly introduced advisory instead of hiding the parent chain', () => {
  const report = {
    vulnerabilities: {
      app: { severity: 'high', via: ['image-size', 'other-package'] },
      'image-size': {
        severity: 'high',
        via: [advisory('https://github.com/advisories/GHSA-allowed')],
      },
      'other-package': {
        severity: 'critical',
        via: [advisory('https://github.com/advisories/GHSA-new')],
      },
    },
  };

  assert.deepEqual(resolveBlockingAdvisories(report), [
    'https://github.com/advisories/GHSA-allowed',
    'https://github.com/advisories/GHSA-new',
  ]);
});

test('fails closed when npm references an unresolved vulnerable package', () => {
  const report = {
    vulnerabilities: {
      app: { severity: 'high', via: ['missing-package'] },
    },
  };

  assert.deepEqual(resolveBlockingAdvisories(report), ['unresolved:missing-package']);
});

test('security patch fingerprints are portable across Git line endings', () => {
  const reviewed = 'diff --git a/file b/file\n-old\n+new\n';
  const windowsCheckout = reviewed.replaceAll('\n', '\r\n');

  assert.equal(hashSecurityPatch(windowsCheckout), hashSecurityPatch(reviewed));
  assert.notEqual(hashSecurityPatch(`${reviewed}+changed\n`), hashSecurityPatch(reviewed));
});
