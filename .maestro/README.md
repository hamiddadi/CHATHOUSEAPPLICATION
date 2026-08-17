# Maestro E2E

These device flows cover the deterministic pre-authentication release gate. They run on a clean
installation, use stable native `testID` selectors, and do not depend on the displayed language.

## Run

Install the debug app on an Android emulator or iOS simulator, start Metro with `.env.test`, then
run the whole suite:

```sh
maestro test .maestro
```

Run one flow while developing:

```sh
maestro test .maestro/onboarding-carousel.yaml
```

CI installs the pinned Maestro version and runs this directory on both Android and iOS. Every flow
clears application state, so files are independent and their execution order does not matter.

## Scope and limits

- `onboarding-carousel.yaml` covers every first-launch slide and verifies local completion
  persistence after an app restart.
- `auth-privacy-smoke.yaml` covers the age gate and offline access to both legal documents.
- `auth-consent-gate.yaml` covers phone validation and all mandatory acknowledgements, but never
  taps Submit.
- `.env.test` intentionally points API and WebSocket traffic at an unavailable local port. These
  flows do not claim OTP delivery, authenticated navigation, real-time audio, or backend success.
  Those paths require a dedicated test backend/account and device-level permission/audio checks.
