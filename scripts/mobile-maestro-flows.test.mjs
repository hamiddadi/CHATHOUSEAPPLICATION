import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authFlow = readFileSync('.maestro/auth-privacy-smoke.yaml', 'utf8');
const consentFlow = readFileSync('.maestro/auth-consent-gate.yaml', 'utf8');
const carouselFlow = readFileSync('.maestro/onboarding-carousel.yaml', 'utf8');

test('phone-pad keyboard dismissal is restricted to Android', () => {
  for (const flow of [authFlow, consentFlow]) {
    assert.match(flow, /id: 'auth-phone-input'/u);
    assert.match(flow, /id: 'auth-age-confirmation'/u);
    assert.doesNotMatch(flow, /^- hideKeyboard/gmu);
    assert.match(flow, /platform: Android\s+commands:\s+- hideKeyboard/u);
  }
});

test('consent assertions use each platform native accessibility state', () => {
  for (const flow of [authFlow, consentFlow]) {
    assert.match(flow, /platform: Android[\s\S]*?id: 'auth-age-confirmation'\s+checked: false/u);
    assert.match(
      flow,
      /platform: iOS[\s\S]*?id: 'auth-age-confirmation'\s+text: 'checkbox, unchecked'/u,
    );
    assert.match(flow, /platform: Android[\s\S]*?id: 'auth-age-confirmation'\s+checked: true/u);
    assert.match(
      flow,
      /platform: iOS[\s\S]*?id: 'auth-age-confirmation'\s+text: 'checkbox, checked'/u,
    );
  }

  for (const consent of ['terms-acceptance', 'privacy-acknowledgement']) {
    assert.match(consentFlow, new RegExp(`id: 'auth-${consent}'\\s+checked: false`, 'u'));
    assert.match(consentFlow, new RegExp(`id: 'auth-${consent}'\\s+checked: true`, 'u'));
    assert.match(
      consentFlow,
      new RegExp(`id: 'auth-${consent}'\\s+text: 'checkbox, unchecked'`, 'u'),
    );
    assert.match(
      consentFlow,
      new RegExp(`id: 'auth-${consent}'\\s+text: 'checkbox, checked'`, 'u'),
    );
  }
});

test('carousel persistence allows a full cold-start accessibility bootstrap', () => {
  assert.match(
    carouselFlow,
    /- stopApp\s+- launchApp\s+- extendedWaitUntil:\s+visible:\s+id: 'auth-get-started'\s+timeout: 45000/u,
  );
});

test('onboarding skip taps retry only when the interface remains unchanged', () => {
  for (const flow of [authFlow, consentFlow]) {
    assert.match(flow, /id: 'welcome-skip'\s+retryTapIfNoChange: true/u);
  }
});
