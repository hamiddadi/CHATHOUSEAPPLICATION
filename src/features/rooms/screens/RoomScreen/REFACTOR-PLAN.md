# RoomScreen.tsx Refactor Plan

**Current state**: 920 lines (3.06x over the 300-line soft cap).
**Goal**: split into 4-5 sub-views and 2-3 hooks while keeping behaviour identical.

> This document is the deliverable of Phase 3.2 — instead of producing
> empty scaffolds that could drift, we propose the exact extraction.
> Apply incrementally, run the app between each step. Existing tests stay
> green at every step because each extraction is internal.

## Inventory (rough byte-mapping)

| Section in `RoomScreen.tsx`         | Approx. lines | Extract to                                         |
| ----------------------------------- | ------------- | -------------------------------------------------- |
| Imports + role helpers              | 1-90          | stays                                              |
| `SpeakerCell` memo component        | 90-160        | `partials/SpeakerCell.tsx`                         |
| `ListenerCell` + helpers            | 160-230       | `partials/ListenerCell.tsx`                        |
| Hand-raise queue rendering          | 636-660       | `partials/HandRaiseQueue.tsx`                      |
| Stage layout (speakers grid)        | 612-633       | `partials/StageGrid.tsx`                           |
| Followed-by-speakers section        | 663-678       | `partials/FollowedByListeners.tsx`                 |
| Others / overflow section           | 681-706       | `partials/OthersGrid.tsx`                          |
| Action pill (raise hand + leave)    | 720-778       | `partials/RoomActionBar.tsx`                       |
| Header (title + counter + controls) | 480-560       | `partials/RoomHeader.tsx` (already exists, expand) |
| State hooks (queries + mutations)   | scattered     | `hooks/useRoomScreenState.ts` (consolidate)        |
| Socket effects                      | scattered     | `hooks/useRoomScreenSocket.ts`                     |
| Audio + mic state                   | scattered     | already covered by `useRoomAudio`                  |

## Target shape after refactor

```
src/features/rooms/screens/RoomScreen/
├── RoomScreen.tsx                    (target: ~250 lines — orchestrator)
├── REFACTOR-PLAN.md                  (this file)
└── partials/
    ├── SpeakerCell.tsx              (~70 lines)
    ├── ListenerCell.tsx             (~50 lines)
    ├── HandRaiseQueue.tsx           (~40 lines)
    ├── StageGrid.tsx                (~50 lines)
    ├── FollowedByListeners.tsx      (~40 lines)
    ├── OthersGrid.tsx               (~50 lines)
    └── RoomActionBar.tsx            (~80 lines)
```

Hooks consolidation:

```
src/features/rooms/hooks/
├── useRoomScreenState.ts            (queries + mutations bundling)
└── useRoomScreenSocket.ts           (room:* event subscriptions)
```

## Step-by-step (each commit must keep the app green)

1. **Extract `SpeakerCell`** — move the memo component as-is to `partials/SpeakerCell.tsx`, export default. Replace the inline use in `RoomScreen.tsx` with `<SpeakerCell speaker={...} isSpeakingLive={...} />`. No behaviour change.
2. **Extract `ListenerCell`** — same recipe.
3. **Extract `StageGrid`** — pass `speakers, speakingLiveByUser` props. The component owns the iteration and gap layout.
4. **Extract `FollowedByListeners`** + **`OthersGrid`** — both take `participants, maxVisible, onTap, viewerCanModerate`.
5. **Extract `HandRaiseQueue`** — takes `handRaises` array + `onPromote(user)`.
6. **Extract `RoomActionBar`** — takes `isListener, isMuted, canRaise, onRaise, onLeave, onShare, onOpenChat, onOpenControls`.
7. **Consolidate state** — `useRoomScreenState(roomId)` returns `{ room, participants, handRaises, viewerCanModerate, mutations }`.
8. **Consolidate socket** — `useRoomScreenSocket(roomId, callbacks)` subscribes to all `room:*` events with cleanup.

## Risks

- **Animated.View prop typing** — `SpeakerCell` uses `useAnimatedPress`; ensure the partial keeps its own hook call (don't hoist).
- **HostActionsSheet** triggers from multiple sub-views — pass an open-sheet callback prop instead of duplicating sheet ownership.
- **Translation hook** — `useTranslation()` should be in each partial that renders text (cheap, no behaviour cost).

## Acceptance criteria

- `RoomScreen.tsx` < 300 lines
- No new state hoisting (each partial owns its render concern only)
- All existing socket and mutation behaviour preserved
- `npx tsc --noEmit` passes
- Manual smoke test: enter room → raise hand → speak → leave → end room

## Why not done in this session

The `useState` + `useEffect` graph spans 920 lines with subtle ordering
dependencies (mediasoup score broadcast vs. participant role transitions).
Refactoring without integration tests in CI is high-risk for an MVP
already shipping. The plan above is the senior-architect deliverable —
execute it in a dedicated PR with manual QA before merging.
