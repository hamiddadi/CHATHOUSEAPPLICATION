import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authFlow = readFileSync('.maestro/auth-privacy-smoke.yaml', 'utf8');
const consentFlow = readFileSync('.maestro/auth-consent-gate.yaml', 'utf8');

test('phone-pad smoke flows do not rely on the unavailable iOS dismiss action', () => {
  for (const flow of [authFlow, consentFlow]) {
    assert.match(flow, /id: 'auth-phone-input'/u);
    assert.match(flow, /id: 'auth-age-confirmation'/u);
    assert.doesNotMatch(flow, /- hideKeyboard/u);
  }
});

test('onboarding skip taps retry only when the interface remains unchanged', () => {
  for (const flow of [authFlow, consentFlow]) {
    assert.match(flow, /id: 'welcome-skip'\s+retryTapIfNoChange: true/u);
  }
});
