# Restructure Plan — Phases 2 & 3

> Last updated: 2026-05-26
> Phase 1 (purely additive — docs, shared/, scripts/) is already done.

This document tracks the **non-additive** restructuring work that requires
explicit authorization because it modifies existing code and configs.

---

## Phase 2 — Low-risk modifications

### 2.1 Extend backend `tsconfig.json` path aliases

Current:

```jsonc
"paths": { "@/*": ["src/*"] }
```

Target:

```jsonc
"paths": {
  "@/*": ["src/*"],
  "@config/*": ["src/config/*"],
  "@modules/*": ["src/modules/*"],
  "@middlewares/*": ["src/middlewares/*"],
  "@socket/*": ["src/socket/*"],
  "@webrtc/*": ["src/webrtc/*"],
  "@queues/*": ["src/queues/*"],
  "@utils/*": ["src/utils/*"],
  "@extensions/*": ["src/extensions/*"]
}
```

**Impact**: modifies `backend/tsconfig.json` (already in M list — was edited
pre-session). Adding aliases is backward-compatible because existing
`../../` imports keep working. Estimated effort: 5 min. Risk: nil.

### 2.2 Add `.env.example` keys for Vague 7 features

The current `.env.example` does not advertise `STRIPE_*`, `ASR_*`,
`TWITTER_*`, `CONTACTS_HASH_SALT`. Add them as commented placeholders.

**Impact**: modifies `backend/.env.example` (currently untracked).
Risk: nil.

### 2.3 README per feature

Add a 5-10 line `README.md` in each `src/features/<domain>/` and
`backend/src/modules/<domain>/` describing:

- Purpose of the module
- Public exports
- Related socket events / routes
- Dependencies

**Impact**: creates ~30 new files. Risk: nil.

### 2.4 Workspace `package.json` at root for npm workspaces

Convert the repo to an npm workspaces monorepo:

```json
"workspaces": ["backend"]
```

Lets `npm install` at root install both side projects. Existing scripts
unchanged.

**Impact**: modifies root `package.json`. Risk: low (some CI scripts may
need adjustment).

---

## Phase 3 — Destructive modifications (NEEDS APPROVAL)

### 3.1 Move `src/` → `mobile/src/`

The target structure separates `mobile/` and `backend/` at the monorepo
root. This touches:

- `App.tsx`, `index.ts`, `app.config.js`, `app.json`, `babel.config.js`,
  `metro.config.js`, `jest.config.js`, `tsconfig.json`, `global.css`,
  `eas.json`
- Every internal import (~hundreds of files)
- Husky pre-commit paths
- ESLint config
- Sentry source map paths
- Coverage reports
- The `.expo/` cached artifacts

**Effort**: 4-8 hours, **Risk: high**. Single biggest source of regression.

### 3.2 Refactor `RoomScreen.tsx` (920 lines) into sub-components

Split into `Stage/`, `ListenersGrid/`, `Controls/`, `ChatSidebar/` etc.
Already partially modular under `src/features/rooms/components/`, but the
top-level screen holds a lot of state.

**Effort**: 1-2 days. **Risk: medium** (state coupling).

### 3.3 Convert Fastify routers → NestJS modules

The target structure uses `@Module`, `@Controller`, `@Injectable`
decorators. The current stack is `express + zod + custom router`. Migration
is essentially a framework switch.

**Effort**: 1-2 weeks. **Risk: very high**. Would require migrating:

- All 15 modules (auth, rooms, users, etc.)
- All middleware
- Socket.io gateway
- Test infrastructure
- Build pipeline

**Recommendation**: defer. Fastify-style routers are perfectly valid; the
benefit/cost ratio of switching frameworks is negative for an already
production-ready backend.

### 3.4 Split `theme.ts` (451 lines) into `lightTheme.ts` / `darkTheme.ts`

Already partially handled by Vague 2's `ExtThemeProvider` which wraps the
existing `ThemeProvider` for runtime mode switching. Splitting the static
file is cosmetic.

**Effort**: 1 hour. **Risk: low**.

---

## Decision matrix

| Item                   | Recommended | Effort    | Risk      |
| ---------------------- | ----------- | --------- | --------- |
| 2.1 backend aliases    | 🟢 Do       | 5 min     | Nil       |
| 2.2 .env.example keys  | 🟢 Do       | 5 min     | Nil       |
| 2.3 README per feature | 🟢 Do       | 30 min    | Nil       |
| 2.4 npm workspaces     | 🟡 Optional | 30 min    | Low       |
| 3.1 mobile/ separation | 🔴 Defer    | 1-2 days  | High      |
| 3.2 RoomScreen split   | 🟡 Optional | 1-2 days  | Medium    |
| 3.3 NestJS migration   | 🔴 Avoid    | 1-2 weeks | Very high |
| 3.4 Theme split        | 🟢 Optional | 1 h       | Low       |

**The author of this plan recommends executing 2.1, 2.2, 2.3 only.**
Items 3.x should be debated with the team — for an MVP that already
ships features, the structure churn rarely pays off.
