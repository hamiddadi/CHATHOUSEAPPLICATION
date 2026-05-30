# Code Conventions

Rules every contributor follows. Aligned with the existing ESLint + Prettier
configuration.

## File naming

| Kind                     | Convention                                               | Example                |
| ------------------------ | -------------------------------------------------------- | ---------------------- |
| React component          | `PascalCase.tsx`                                         | `RoomCard.tsx`         |
| Hook                     | `useCamelCase.ts`                                        | `useRoomAudio.ts`      |
| Service                  | `camelCase.ts` (no `Service` suffix when in `services/`) | `roomService.ts`       |
| Constants                | `camelCase.ts`                                           | `socketEvents.ts`      |
| Backend module           | `<module>.<role>.ts`                                     | `rooms.service.ts`     |
| Folder under `features/` | `kebab-case` for multi-word, single word otherwise       | `rooms/`, `room-feed/` |
| TypeScript interface     | `PascalCase`, no `I` prefix                              | `User`, `Room`         |
| TypeScript type alias    | `PascalCase`, no suffix                                  | `Role`                 |
| Constants                | `UPPER_SNAKE_CASE`                                       | `MAX_PARTICIPANTS`     |

## Folder layout per feature

```
src/features/<domain>/
├── screens/        UI screens consumed by the navigator
├── components/     Feature-local composite components
├── hooks/          Feature-local hooks (data fetching, derived state)
├── services/       HTTP / socket access from this domain
├── store/          Domain-specific state (Zustand / React Query keys)
├── types/          TypeScript types
└── index.ts        Barrel — public exports only
```

Backend mirror:

```
backend/src/modules/<domain>/
├── <domain>.controller.ts   Request/response handlers
├── <domain>.service.ts      Business logic
├── <domain>.router.ts       Express router (replaces NestJS @Module)
├── <domain>.schema.ts       Zod validation
└── <domain>.types.ts        (optional)
```

## File size budget

| File kind        | Soft cap  | Action if exceeded                      |
| ---------------- | --------- | --------------------------------------- |
| Screen component | 200 lines | Split into sub-components               |
| Service          | 300 lines | Split by concern or extract sub-service |
| Util             | 150 lines | Split or rethink scope                  |
| Backend service  | 400 lines | Split by sub-domain                     |

Current outliers (as of 2026-05-26):

- `RoomScreen.tsx` — 920 lines (split candidates: Stage, Listeners grid, Controls, Chat sidebar)
- `SettingsScreen.tsx` — 598 lines
- `ChatDetailScreen.tsx` — 566 lines
- `CreateRoomScreen.tsx` — 473 lines
- `roomService.ts` — 446 lines
- `theme.ts` — 451 lines

## Imports

Use the path aliases declared in `tsconfig.json`:

```ts
// Good
import { useRoomAudio } from '@features/rooms/hooks/useRoomAudio';
import { Avatar } from '@shared/components';

// Avoid
import { useRoomAudio } from '../../features/rooms/hooks/useRoomAudio';
```

Backend (after Phase 2 alias extension):

```ts
import { prisma } from '@/config/database';
import { requireAuth } from '@/middlewares/auth.middleware';
```

Today only `@/*` is wired backend-side; richer aliases come in Phase 2.

## TypeScript

- `strict: true` (already enforced)
- No `any` in new code — use `unknown` and narrow
- Public function signatures must have explicit return types
- Discriminated unions over enums when possible

## Error handling

- Always `try/catch` async API entry points
- Use the existing `AppError` (legacy) or new `ExtAppError` (extensions)
- Never leak stack traces in API responses (the global error middleware
  redacts in production)
- Log via the existing `logger` (winston-backed)

## Tests

Pre-existing tests live in `backend/tests/*.test.ts` and a handful of
`src/**/*.test.{ts,tsx}` files. The Clubhouse-parity QA suite was scaffolded
and then removed at the user's request — re-add it under
`backend/tests/clubhouse/` if needed.

Coverage targets are not currently enforced (no CI gate).

## Commits

The repo uses Husky + lint-staged for pre-commit ESLint+Prettier. Pre-push
runs `npm run quality` (lint + format check + typecheck).
