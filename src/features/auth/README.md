# features/auth

Phone-OTP authentication + session management.

## Screens

- `LandingScreen` — entry point
- `PhoneScreen` — phone input
- `OtpScreen` — code verification
- `UsernameScreen` — first-time username pick
- `WaitlistScreen` — pre-launch waitlist

## Services

- `tokenStorage` — SecureStore wrapper for access/refresh tokens
- `authService` — login, OTP request, refresh
- API client interceptors in `src/shared/services/api/`

## Notes

- OTP currently 6 digits (Clubhouse-parity audit flagged a target of 4)
- Refresh token rotation handled server-side; client stores both tokens in SecureStore
- Onboarding interest validator (`>=3 interests`) shipped in
  `src/features/extensions/utils/interestsValidator.ts` (Vague 2)
