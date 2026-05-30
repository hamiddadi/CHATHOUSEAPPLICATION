# features/extensions

Frontend half of the 7-vagues Clubhouse-parity additive layer. Every file
here is pure addition — nothing imports a legacy screen, every legacy
screen is free to ignore this folder.

## Vague 1 — Onboarding & social

- `api/suggestionsApi`, `hooks/useSuggestions`, `screens/ExtSuggestedFollowsScreen`
- `api/contactsApi`, `hooks/useContactsSync` (SHA-256 phone hashing)
- `api/presenceApi`, `hooks/usePresence`, `components/ExtAvailablePeopleStrip`
- `api/topicsApi`, `hooks/useTopics`, `screens/ExtTopicExplorerScreen`
- `utils/socialDeepLink` (Twitter / Instagram native open)
- `components/ExtLinkifiedText` (URL parsing in chat)

## Vague 2 — UX polish

- `providers/ExtThemeProvider`, `components/ExtThemeToggle` (auto/light/dark)
- `utils/interestsValidator` (min-3 enforcement)
- `api/eventsApi` (cancel event), `api/chatmodApi` (delete message)

## Vague 3 — Hall & search

- `api/upcomingApi`, `hooks/useUpcoming`, `components/ExtUpcomingForYouStrip`
- `api/privacyApi`
- `api/searchExtApi`

## Vague 4 — Audio settings

- `api/audioApi` (Standard/High/Music tier prefs)
- `api/netqualityApi` (3-bar network indicator)

## Vague 5 — Clubs

- `api/clubReqApi` (join request workflow)

## Vague 6 — Accessibility

- `hooks/useExtFontScale` (Dynamic Type / Android font size)

## Vague 7 — Monetization & external auth

- `api/paymentsApi` (Stripe Connect — feature-flagged)

## Public surface

All exports surface via `src/features/extensions/index.ts`. Consumers
import as:

```ts
import {
  ExtSuggestedFollowsScreen,
  ExtThemeProvider,
  useExtAvailablePeople,
  validateInterests,
} from '@/features/extensions';
```

## Wiring

These screens/components/hooks are NOT yet wired into the navigator.
They're ready to be mounted whenever the legacy navigator is extended
(adding a route entry, replacing a strip, wrapping the root with
`<ExtThemeProvider>`, etc.). See `backend/src/extensions/DELIVERY-FINAL.md`
for the backend-side endpoints they call.
