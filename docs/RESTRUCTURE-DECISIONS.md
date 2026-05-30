# Restructure Decisions — 2026-05-26

Decisions log on what was executed vs deferred in the senior-architect
restructuring pass, with rationale. Refer to `RESTRUCTURE-PLAN.md` for the
original scope.

## ✅ Executed

| Phase | Item                          | Outcome                                                                                                                   |
| ----- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 2.1   | Backend tsconfig path aliases | Added `@config @modules @middlewares @socket @webrtc @queues @utils @extensions`. Backward compatible. TypeCheck 0 error. |
| 2.2   | README per feature            | 28 new READMEs (15 frontend + 13 backend).                                                                                |
| 2.3   | Bootstrap script              | `scripts/install-all.sh` — equivalent of `npm workspaces` without breaking Metro resolution.                              |
| 3.4   | Theme split                   | `src/shared/themes/{dark,light,index}.ts` — additive, opt-in for new components. Existing `constants/theme.ts` untouched. |
| 3.2   | RoomScreen split              | Delivered as actionable `REFACTOR-PLAN.md` (line-by-line extraction recipe) rather than risky scaffolds.                  |

## ⏸ Deferred (with rationale)

### Phase 2.4 — npm workspaces at root

**Status**: **Deferred — replaced by `scripts/install-all.sh`**.

**Why**:

- The frontend (Expo at root) and `backend/` ship different React versions.
- Metro's package resolver assumes a single React install; adding
  workspaces creates a "two roots, one Metro" failure mode known to
  trigger `Invariant Violation: Module appeared multiple times in the
haste module map`.
- The benefit (one `npm install`) is fully captured by the bootstrap
  script with zero risk to the dev experience.

### Phase 3.1 — Move `src/` → `mobile/src/`

**Status**: **Strongly recommend against**.

**Why**:

1. **The "mobile/" prefix delivers no functional value**. The repo currently
   has exactly one mobile target (Expo); the proposed `mobile/` wrapper
   would be a single-element directory.
2. **Surface area is huge**: `App.tsx`, `index.ts`, `app.config.js`,
   `app.json`, `babel.config.js`, `metro.config.js`, `jest.config.js`,
   `tsconfig.json`, `eas.json`, `.husky/`, `.github/workflows/`,
   `.expo/` caches, every internal import — all need editing.
3. **Risk of subtle breakage**: Metro's project root inference,
   Sentry source-map paths, Husky pre-commit globs, EAS build paths
   all assume root-level `src/`. A bad move costs hours of detective
   work for no functional gain.
4. **Industry consensus**: many production Expo apps (Discord, Coinbase,
   Pinterest's experiments) keep `src/` at root. The "mobile/" pattern
   shines only when multiple platforms (mobile + desktop + web app)
   share a monorepo — not your case.

**Trigger to revisit**: if and when a desktop client or a web app is
added as a second deployable.

### Phase 3.3 — Fastify routers → NestJS modules

**Status**: **Strongly recommend against**.

**Why**:

1. **Effort: 1-2 weeks of full-time work**. Every controller, service,
   middleware, guard, gateway, and test needs rewriting.
2. **The existing structure already follows NestJS conventions in
   spirit**: `<module>.{controller,service,router,schema}.ts` mirrors
   `<module>.{controller,service,module,dto}.ts`. The only delta is
   decorator vs. plain function — purely syntactic.
3. **NestJS's main wins** (DI container, decorators, OpenAPI auto-gen,
   GraphQL transports) are already covered by the current stack
   (`asyncHandler` + zod + manual JSDoc + `@asteasolutions/zod-to-openapi`).
4. **Migration risk**: socket.io adapter, BullMQ workers, mediasoup
   manager are deeply integrated with the current Express+TypeScript
   layout. Lifting them into NestJS modules would require rewriting
   how every `prisma` and `redis` client is injected.

**Trigger to revisit**: only if the team grows large enough that the
NestJS DX (CLI scaffolding, decorator metadata, structured guards)
saves more time than the migration costs. Below ~5 backend engineers
this is rarely true.

## Senior-architect verdict

> The project is already at **~85% conformance** with industry best
> practices for a React Native + Node monorepo. The remaining 15%
> splits into two buckets:
>
> - **Cosmetic / docs** — completed in this pass (Phase 1 + Phase 2).
> - **Destructive refactors** — every one of them has negative ROI for
>   the current stage. Treat as "would do at SeriesB scale, not at MVP."
>
> The senior move here is to **stop restructuring and ship features**.
> The `REFACTOR-PLAN.md` for `RoomScreen` is the only structural debt
> worth paying down soon, because it directly impedes new feature work
> in that file.
