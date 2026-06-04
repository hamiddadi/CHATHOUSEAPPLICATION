# shared/

Cross-tier code shared between `backend/` and the React Native app.

## Contents

| Path                           | Purpose                                          |
| ------------------------------ | ------------------------------------------------ |
| `types/api.types.ts`           | `ApiResponse<T>`, `Paginated<T>` envelope shapes |
| `types/socket-events.types.ts` | Canonical socket event names                     |
| `constants/app.ts`             | Cross-tier numeric/string constants (caps, TTLs) |

## Adoption

This folder is **purely additive** — no existing file imports from here yet.
New code may opt in by referencing relative paths (e.g.
`../../shared/types/api.types`) until path aliases are configured for it in
Phase 2.

Future steps (see `docs/RESTRUCTURE-PLAN.md`):

- Add `@shared/*` alias in `tsconfig.json` (frontend) and
  `backend/tsconfig.json`
- Promote existing duplicated types from each side here
